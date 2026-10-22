//! A minimal connection over Postgres's replication protocol, enough to
//! mint exported snapshots: the startup message asks for
//! `replication=database`, authentication follows the server's choice
//! (trust, password, MD5, SCRAM-SHA-256), and replication commands go
//! through the simple query protocol. `tokio-postgres` builds its startup
//! message from a fixed set of parameters and cannot open such a
//! connection, so the handful of messages involved are spoken directly
//! with `postgres-protocol`. Plain TCP or Unix sockets, no TLS. Once a
//! slot has exported its snapshot, anything sent on the connection discards
//! the snapshot, so the connection is kept without a byte: the kernel
//! probes it while silent ([`keep_alive`]), and the session is opened with
//! PostgreSQL's idle timeout off and its end probing too
//! ([`session_options`]).

use std::io;
use std::time::Duration;

use bytes::BytesMut;
use fallible_iterator::FallibleIterator;
use postgres_protocol::authentication::{self, sasl};
use postgres_protocol::message::backend::Message;
use postgres_protocol::message::frontend;
use socket2::{SockRef, TcpKeepalive};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpStream, UnixStream};
use tokio_postgres::Config;
use tokio_postgres::config::Host;

use crate::sync::storage::StorageError;

/// The socket underneath, either flavor; `Detached` is a connection that
/// was never opened (a placeholder for tests of the alias bookkeeping).
enum Socket {
    Tcp(TcpStream),
    Unix(UnixStream),
    Detached,
}

impl Socket {
    /// Read into `buffer`; the number of bytes read (zero at end of stream).
    async fn read(&mut self, buffer: &mut BytesMut) -> io::Result<usize> {
        match self {
            Socket::Tcp(stream) => stream.read_buf(buffer).await,
            Socket::Unix(stream) => stream.read_buf(buffer).await,
            Socket::Detached => Err(io::ErrorKind::NotConnected.into()),
        }
    }

    /// Write all of `bytes`.
    async fn write(&mut self, bytes: &[u8]) -> io::Result<()> {
        match self {
            Socket::Tcp(stream) => stream.write_all(bytes).await,
            Socket::Unix(stream) => stream.write_all(bytes).await,
            Socket::Detached => Err(io::ErrorKind::NotConnected.into()),
        }
    }
}

/// One open replication connection. Dropping it closes the socket, which
/// drops every temporary slot it created and invalidates the snapshot it
/// exported.
pub struct ReplicationConnection {
    socket: Socket,
    buffer: BytesMut,
}

impl ReplicationConnection {
    /// A connection that was never opened: every use fails with
    /// `NotConnected`. Lets tests build an [`super::Alias`] without a
    /// server.
    pub fn detached() -> Self {
        ReplicationConnection {
            socket: Socket::Detached,
            buffer: BytesMut::new(),
        }
    }

    /// Connect with `config`'s first host, user, password and database in
    /// replication mode and authenticate; a TCP connection is probed while
    /// silent as `config` asks ([`keep_alive`]), and the session is opened
    /// with the settings that let it stay silent ([`session_options`]).
    pub async fn open(config: &Config) -> Result<Self, StorageError> {
        let host = config
            .get_hosts()
            .first()
            .ok_or_else(|| StorageError("the connection string names no host".to_owned()))?;
        let port = config.get_ports().first().copied().unwrap_or(5432);
        let socket = match host {
            Host::Tcp(host) => {
                let stream = TcpStream::connect((host.as_str(), port))
                    .await
                    .map_err(io_error)?;
                keep_alive(&stream, config).map_err(io_error)?;
                Socket::Tcp(stream)
            }
            Host::Unix(dir) => {
                let path = dir.join(format!(".s.PGSQL.{port}"));
                Socket::Unix(UnixStream::connect(path).await.map_err(io_error)?)
            }
        };
        let user = config
            .get_user()
            .ok_or_else(|| StorageError("the connection string names no user".to_owned()))?
            .to_owned();
        let mut connection = ReplicationConnection {
            socket,
            buffer: BytesMut::with_capacity(8192),
        };
        let mut params = vec![
            ("client_encoding", "UTF8"),
            ("user", user.as_str()),
            ("replication", "database"),
        ];
        if let Some(dbname) = config.get_dbname() {
            params.push(("database", dbname));
        }
        let options = session_options(config);
        params.push(("options", options.as_str()));
        let mut out = BytesMut::new();
        frontend::startup_message(params, &mut out).map_err(io_error)?;
        connection.socket.write(&out).await.map_err(io_error)?;
        connection
            .authenticate(&user, config.get_password())
            .await?;
        connection.until_ready().await?;
        Ok(connection)
    }

    /// Run one command and return its rows as text columns (`None` for
    /// SQL `NULL`).
    pub async fn simple_query(
        &mut self,
        sql: &str,
    ) -> Result<Vec<Vec<Option<String>>>, StorageError> {
        let mut out = BytesMut::new();
        frontend::query(sql, &mut out).map_err(io_error)?;
        self.socket.write(&out).await.map_err(io_error)?;
        let mut rows = Vec::new();
        loop {
            match self.next_message().await? {
                Message::DataRow(body) => {
                    let mut row = Vec::new();
                    let mut ranges = body.ranges();
                    while let Some(range) = ranges.next().map_err(io_error)? {
                        row.push(range.map(|range| {
                            String::from_utf8_lossy(&body.buffer()[range]).into_owned()
                        }));
                    }
                    rows.push(row);
                }
                Message::ReadyForQuery(_) => return Ok(rows),
                Message::ErrorResponse(body) => return Err(server_error(body.fields())),
                _ => {}
            }
        }
    }

    /// Answer the server's authentication request with the password.
    async fn authenticate(
        &mut self,
        user: &str,
        password: Option<&[u8]>,
    ) -> Result<(), StorageError> {
        let missing = || {
            StorageError(
                "the server asked for a password and the connection string has none".to_owned(),
            )
        };
        match self.next_message().await? {
            Message::AuthenticationOk => return Ok(()),
            Message::AuthenticationCleartextPassword => {
                self.send_password(password.ok_or_else(missing)?).await?;
            }
            Message::AuthenticationMd5Password(body) => {
                let hashed = authentication::md5_hash(
                    user.as_bytes(),
                    password.ok_or_else(missing)?,
                    body.salt(),
                );
                self.send_password(hashed.as_bytes()).await?;
            }
            Message::AuthenticationSasl(body) => {
                let mut offered = body.mechanisms();
                let mut scram = false;
                while let Some(mechanism) = offered.next().map_err(io_error)? {
                    scram |=
                        mechanism == sasl::SCRAM_SHA_256 || mechanism == sasl::SCRAM_SHA_256_PLUS;
                }
                if !scram {
                    return Err(StorageError(
                        "the server offers no SCRAM-SHA-256 authentication".to_owned(),
                    ));
                }
                let mut exchange = sasl::ScramSha256::new(
                    password.ok_or_else(missing)?,
                    sasl::ChannelBinding::unsupported(),
                );
                let mut out = BytesMut::new();
                frontend::sasl_initial_response(sasl::SCRAM_SHA_256, exchange.message(), &mut out)
                    .map_err(io_error)?;
                self.socket.write(&out).await.map_err(io_error)?;
                match self.next_message().await? {
                    Message::AuthenticationSaslContinue(body) => {
                        exchange.update(body.data()).map_err(io_error)?
                    }
                    Message::ErrorResponse(body) => return Err(server_error(body.fields())),
                    _ => return Err(StorageError("unexpected message during SCRAM".to_owned())),
                }
                let mut out = BytesMut::new();
                frontend::sasl_response(exchange.message(), &mut out).map_err(io_error)?;
                self.socket.write(&out).await.map_err(io_error)?;
                match self.next_message().await? {
                    Message::AuthenticationSaslFinal(body) => {
                        exchange.finish(body.data()).map_err(io_error)?
                    }
                    Message::ErrorResponse(body) => return Err(server_error(body.fields())),
                    _ => return Err(StorageError("unexpected message during SCRAM".to_owned())),
                }
            }
            Message::ErrorResponse(body) => return Err(server_error(body.fields())),
            _ => return Err(StorageError("unsupported authentication method".to_owned())),
        }
        match self.next_message().await? {
            Message::AuthenticationOk => Ok(()),
            Message::ErrorResponse(body) => Err(server_error(body.fields())),
            _ => Err(StorageError(
                "unexpected message after authentication".to_owned(),
            )),
        }
    }

    /// Send a password message.
    async fn send_password(&mut self, password: &[u8]) -> Result<(), StorageError> {
        let mut out = BytesMut::new();
        frontend::password_message(password, &mut out).map_err(io_error)?;
        self.socket.write(&out).await.map_err(io_error)
    }

    /// Consume the startup's parameter and key messages up to the first
    /// ready-for-query.
    async fn until_ready(&mut self) -> Result<(), StorageError> {
        loop {
            match self.next_message().await? {
                Message::ReadyForQuery(_) => return Ok(()),
                Message::ErrorResponse(body) => return Err(server_error(body.fields())),
                _ => {}
            }
        }
    }

    /// The next backend message, reading from the socket as needed.
    async fn next_message(&mut self) -> Result<Message, StorageError> {
        loop {
            if let Some(message) = Message::parse(&mut self.buffer).map_err(io_error)? {
                return Ok(message);
            }
            if self.socket.read(&mut self.buffer).await.map_err(io_error)? == 0 {
                return Err(StorageError("the replication connection closed".to_owned()));
            }
        }
    }
}

/// The session settings the startup message carries, in its `options`
/// (the DSN's own, as tokio-postgres passes them, first). The session
/// holds its snapshot for as long as the alias lives without a command
/// ever being sent on it, so PostgreSQL's idle-in-transaction timeout,
/// which would end the session and the snapshot with it, is turned off
/// for this session, a setting every role may make for its own; and
/// PostgreSQL's end of the connection is told to probe this one as this
/// one probes it ([`keep_alive`]), so either side notices a dead peer in
/// the same time instead of after the kernel's default hours.
fn session_options(config: &Config) -> String {
    let mut options = config.get_options().unwrap_or_default().to_owned();
    let mut set = |setting: &str, value: &str| {
        if !options.is_empty() {
            options.push(' ');
        }
        options.push_str(&format!("-c {setting}={value}"));
    };
    set("idle_in_transaction_session_timeout", "0");
    if config.get_keepalives() {
        set(
            "tcp_keepalives_idle",
            &seconds(config.get_keepalives_idle()),
        );
        if let Some(interval) = config.get_keepalives_interval() {
            set("tcp_keepalives_interval", &seconds(interval));
        }
        if let Some(retries) = config.get_keepalives_retries() {
            set("tcp_keepalives_count", &retries.to_string());
        }
    }
    options
}

/// A duration as the whole seconds PostgreSQL's keepalive settings take,
/// one at the least (zero would mean the kernel's default).
fn seconds(duration: Duration) -> String {
    duration.as_secs().max(1).to_string()
}

/// Have the kernel probe `stream` while it is silent, as `config` asks
/// (`keepalives`, `keepalives_idle`, `keepalives_interval` and
/// `keepalives_retries`, the settings tokio-postgres applies to the
/// connections it opens). Nothing can be sent on a minting connection to
/// keep it: any command, even `SELECT 1`, discards the snapshot it
/// exported. A probe is a bare TCP segment the peer's kernel answers with
/// PostgreSQL never involved, and whatever is between (a NAT, a load
/// balancer) that drops silent flows counts it as traffic. Once `idle` has
/// passed without a byte either way a probe goes out; answered, the clock
/// restarts and the connection lives on; unanswered, the next follows after
/// `interval`, and after `retries` unanswered in a row the kernel gives the
/// connection up, which this side learns of the next time it uses it.
fn keep_alive(stream: &TcpStream, config: &Config) -> io::Result<()> {
    if !config.get_keepalives() {
        return Ok(());
    }
    let mut probing = TcpKeepalive::new().with_time(config.get_keepalives_idle());
    #[cfg(not(any(
        target_os = "aix",
        target_os = "redox",
        target_os = "solaris",
        target_os = "openbsd"
    )))]
    if let Some(interval) = config.get_keepalives_interval() {
        probing = probing.with_interval(interval);
    }
    #[cfg(not(any(
        target_os = "aix",
        target_os = "redox",
        target_os = "solaris",
        target_os = "windows",
        target_os = "openbsd"
    )))]
    if let Some(retries) = config.get_keepalives_retries() {
        probing = probing.with_retries(retries);
    }
    SockRef::from(stream).set_tcp_keepalive(&probing)
}

/// An I/O or protocol error as a storage error.
fn io_error(error: io::Error) -> StorageError {
    StorageError(error.to_string())
}

/// A server error response as a storage error carrying its message.
fn server_error(mut fields: postgres_protocol::message::backend::ErrorFields<'_>) -> StorageError {
    let mut message = String::from("server error");
    while let Ok(Some(field)) = fields.next() {
        if field.type_() == b'M' {
            message = String::from_utf8_lossy(field.value_bytes()).into_owned();
        }
    }
    StorageError(message)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The session is opened with its idle-in-transaction timeout off and
    /// PostgreSQL's end probing at the config's keepalive, in whole
    /// seconds, after whatever options the DSN already carries.
    #[test]
    fn the_session_options_keep_the_session_silent() {
        let mut config = Config::new();
        config
            .keepalives_idle(Duration::from_secs(30))
            .keepalives_interval(Duration::from_millis(10_500))
            .keepalives_retries(3);
        assert_eq!(
            session_options(&config),
            "-c idle_in_transaction_session_timeout=0 -c tcp_keepalives_idle=30 \
             -c tcp_keepalives_interval=10 -c tcp_keepalives_count=3"
        );

        config.options("-c search_path=app");
        assert!(session_options(&config).starts_with("-c search_path=app -c idle_in"));

        let mut config = Config::new();
        config.keepalives(false);
        assert_eq!(
            session_options(&config),
            "-c idle_in_transaction_session_timeout=0"
        );

        let mut config = Config::new();
        config.keepalives_idle(Duration::from_millis(500));
        assert_eq!(
            session_options(&config),
            "-c idle_in_transaction_session_timeout=0 -c tcp_keepalives_idle=1"
        );
    }

    /// A connected socket of this process's own, with `config` applied.
    async fn probed(config: &Config) -> TcpStream {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let stream = TcpStream::connect(listener.local_addr().unwrap())
            .await
            .unwrap();
        keep_alive(&stream, config).unwrap();
        stream
    }

    /// The kernel probes the socket after the idle time the config names,
    /// then at its interval, as many times as it allows.
    #[tokio::test]
    async fn the_socket_is_probed_as_the_config_asks() {
        let mut config = Config::new();
        config
            .keepalives_idle(Duration::from_secs(30))
            .keepalives_interval(Duration::from_secs(10))
            .keepalives_retries(3);
        let stream = probed(&config).await;
        let socket = SockRef::from(&stream);
        assert!(socket.keepalive().unwrap());
        assert_eq!(
            socket.tcp_keepalive_time().unwrap(),
            Duration::from_secs(30)
        );
        #[cfg(any(target_os = "linux", target_os = "macos"))]
        {
            assert_eq!(
                socket.tcp_keepalive_interval().unwrap(),
                Duration::from_secs(10)
            );
            assert_eq!(socket.tcp_keepalive_retries().unwrap(), 3);
        }
    }

    /// With the probing turned off the socket is left as the kernel made it.
    #[tokio::test]
    async fn probing_turned_off_leaves_the_socket_alone() {
        let mut config = Config::new();
        config.keepalives(false);
        let stream = probed(&config).await;
        assert!(!SockRef::from(&stream).keepalive().unwrap());
    }
}
