//! Zero's sync protocol (version 51, the one `@rocicorp/zero` 1.9 speaks)
//! as this server reads and writes it: the upstream messages a client
//! sends, each a two-element JSON array of a tag and a body, the
//! downstream messages it answers with, the base64 handshake
//! header carrying the first message, and the lexicographic version
//! strings that serve as cookies.

use std::collections::HashMap;

use base64::Engine as _;
use serde::Deserialize;
use serde_json::{Value as Json, json};

/// The protocol version this server speaks.
pub const PROTOCOL_VERSION: u32 = 51;

/// One message a client sends.
#[derive(Debug)]
pub enum Upstream {
    InitConnection(Box<InitConnection>),
    Ping,
    ChangeDesiredQueries(Vec<QueryPatchOp>),
    DeleteClients(DeleteClients),
    Push(Push),
    Pull(Pull),
    CloseConnection,
    /// The client has received the application server's results of its
    /// mutations up to this one (from a poke's `mutationsPatch`) and they
    /// may be cleaned up.
    AckMutationResponses(MutationId),
    /// `updateAuth`, `inspect`: acknowledged and otherwise ignored.
    Other(String),
}

/// The first message of a connection: what the client wants synced, and
/// its schema on a first connection.
///
/// The protocol also lets a client name its own query and push endpoints
/// (`userQueryURL`, `userPushURL` and their header maps). This server
/// ignores them: the endpoints are the operator's `STREAMGRES_QUERY_URL`
/// and `STREAMGRES_MUTATE_URL`, whatever the client sends, so a client
/// cannot point the server at an endpoint of its own choosing.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitConnection {
    #[serde(default)]
    pub desired_queries_patch: Vec<QueryPatchOp>,
    #[serde(default)]
    pub client_schema: Option<ClientSchema>,
    #[serde(default)]
    pub deleted: Option<DeleteClients>,
    #[serde(default)]
    pub active_clients: Option<Vec<String>>,
}

/// One change to a client's desired queries.
///
/// A `put` may carry an `ast` of the client's own making (the protocol's
/// legacy queries). This server ignores it: every query's AST comes from
/// the application server's transform of its name and arguments, which is
/// where permissions are applied, so a client cannot hand the server a
/// query the application never authorised.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum QueryPatchOp {
    Put {
        hash: String,
        #[serde(default)]
        ttl: Option<f64>,
        #[serde(default)]
        name: Option<String>,
        #[serde(default)]
        args: Option<Vec<Json>>,
    },
    Del {
        hash: String,
    },
    Clear,
}

/// The client's schema: tables with their columns' types and primary
/// keys, keyed by the names the server knows.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct ClientSchema {
    #[serde(default)]
    pub tables: HashMap<String, ClientTable>,
}

/// One table of the client's schema.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientTable {
    #[serde(default)]
    pub columns: HashMap<String, Json>,
    #[serde(default)]
    pub primary_key: Vec<String>,
}

/// Clients (or whole client groups) the client knows are gone.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteClients {
    #[serde(default, rename = "clientIDs")]
    pub client_ids: Vec<String>,
    #[serde(default, rename = "clientGroupIDs")]
    pub client_group_ids: Vec<String>,
}

/// A batch of mutations to forward: the body as sent (it goes to the
/// application server verbatim) and the ids in it, for the error the
/// the server reports when forwarding fails.
#[derive(Debug, Clone)]
pub struct Push {
    pub body: Json,
    pub client_group_id: String,
    pub mutation_ids: Vec<MutationId>,
}

/// The identity of one mutation.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct MutationId {
    #[serde(rename = "clientID")]
    pub client_id: String,
    pub id: i64,
}

/// A mutation-recovery pull: the client asks for the last mutation ids of
/// its group.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pull {
    #[serde(rename = "clientGroupID")]
    pub client_group_id: String,
    #[serde(default)]
    pub cookie: Option<String>,
    #[serde(rename = "requestID")]
    pub request_id: String,
}

/// Parse one upstream message.
pub fn parse_upstream(text: &str) -> Result<Upstream, String> {
    let message: Json = serde_json::from_str(text).map_err(|error| format!("not JSON: {error}"))?;
    let Json::Array(items) = &message else {
        return Err("a message is a [tag, body] array".to_owned());
    };
    let Some(Json::String(tag)) = items.first() else {
        return Err("a message starts with its tag".to_owned());
    };
    let body = items.get(1).cloned().unwrap_or(Json::Null);
    let parsed = |body: Json| -> Result<Upstream, String> {
        Ok(match tag.as_str() {
            "initConnection" => Upstream::InitConnection(Box::new(deserialize(body)?)),
            "ping" => Upstream::Ping,
            "changeDesiredQueries" => {
                #[derive(Deserialize)]
                #[serde(rename_all = "camelCase")]
                struct Body {
                    #[serde(default)]
                    desired_queries_patch: Vec<QueryPatchOp>,
                }
                let body: Body = deserialize(body)?;
                Upstream::ChangeDesiredQueries(body.desired_queries_patch)
            }
            "deleteClients" => Upstream::DeleteClients(deserialize(body)?),
            "push" => Upstream::Push(parse_push(body)?),
            "pull" => Upstream::Pull(deserialize(body)?),
            "closeConnection" => Upstream::CloseConnection,
            "ackMutationResponses" => Upstream::AckMutationResponses(deserialize(body)?),
            other => Upstream::Other(other.to_owned()),
        })
    };
    parsed(body)
}

/// Deserialize a body, naming the failure.
fn deserialize<T: for<'de> Deserialize<'de>>(body: Json) -> Result<T, String> {
    serde_json::from_value(body).map_err(|error| format!("malformed body: {error}"))
}

/// The parts of a push body the server itself needs.
fn parse_push(body: Json) -> Result<Push, String> {
    let client_group_id = body
        .get("clientGroupID")
        .and_then(Json::as_str)
        .ok_or("a push names its clientGroupID")?
        .to_owned();
    let mutation_ids = body
        .get("mutations")
        .and_then(Json::as_array)
        .map(|mutations| {
            mutations
                .iter()
                .filter_map(|mutation| {
                    Some(MutationId {
                        client_id: mutation.get("clientID")?.as_str()?.to_owned(),
                        id: mutation.get("id")?.as_i64()?,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(Push {
        body,
        client_group_id,
        mutation_ids,
    })
}

/// What the `Sec-WebSocket-Protocol` header carries: the first message,
/// when it fit, and the auth token.
#[derive(Debug, Default)]
pub struct Handshake {
    pub init: Option<InitConnection>,
    pub auth_token: Option<String>,
}

/// Decode the handshake header: URI-encoded base64 of the JSON
/// `{initConnectionMessage, authToken}`.
pub fn decode_handshake(header: &str) -> Result<Handshake, String> {
    let decoded = percent_encoding::percent_decode_str(header)
        .decode_utf8()
        .map_err(|error| format!("handshake header is not UTF-8: {error}"))?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(decoded.as_bytes())
        .or_else(|_| base64::engine::general_purpose::STANDARD_NO_PAD.decode(decoded.as_bytes()))
        .map_err(|error| format!("handshake header is not base64: {error}"))?;
    let json: Json = serde_json::from_slice(&bytes)
        .map_err(|error| format!("handshake header is not JSON: {error}"))?;
    let init = match json.get("initConnectionMessage") {
        Some(Json::Array(items)) if items.len() == 2 => Some(deserialize(items[1].clone())?),
        _ => None,
    };
    let auth_token = json
        .get("authToken")
        .and_then(Json::as_str)
        .map(str::to_owned);
    Ok(Handshake { init, auth_token })
}

/// A version as Zero's lexicographic cookie: the length of its base-36
/// form minus one, then the base-36 form, so string order is numeric
/// order.
pub fn cookie(version: u64) -> String {
    let digits = to_base36(version);
    format!("{}{digits}", to_base36(digits.len() as u64 - 1))
}

/// The version a cookie of [`cookie`]'s form names; `None` for anything
/// else (a cookie another server wrote).
pub fn version_of(cookie: &str) -> Option<u64> {
    let mut chars = cookie.chars();
    let length = chars.next()?.to_digit(36)? as usize + 1;
    let digits = chars.as_str();
    if digits.len() != length || digits.chars().any(|digit| digit.is_ascii_uppercase()) {
        return None;
    }
    u64::from_str_radix(digits, 36).ok()
}

/// A number in base 36, lowercase.
fn to_base36(mut value: u64) -> String {
    const DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if value == 0 {
        return "0".to_owned();
    }
    let mut out = Vec::new();
    while value > 0 {
        out.push(DIGITS[(value % 36) as usize]);
        value /= 36;
    }
    out.reverse();
    String::from_utf8(out).expect("ascii digits")
}

/// Serialize a downstream message.
fn frame(tag: &str, body: Json) -> String {
    Json::Array(vec![Json::String(tag.to_owned()), body]).to_string()
}

/// `connected`: the server's acknowledgement.
pub fn connected(wsid: &str) -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|since| since.as_millis() as u64)
        .unwrap_or_default();
    frame("connected", json!({"wsid": wsid, "timestamp": now}))
}

/// `pong`.
pub fn pong() -> String {
    frame("pong", json!({}))
}

/// `error` with a plain kind and message, from the server.
pub fn error(kind: &str, message: &str) -> String {
    frame(
        "error",
        json!({"kind": kind, "message": message, "origin": "zeroCache"}),
    )
}

/// `error` for a whole push the application server could not take.
pub fn push_failed(
    mutation_ids: &[MutationId],
    status: Option<u16>,
    preview: Option<&str>,
    message: &str,
) -> String {
    let ids: Vec<Json> = mutation_ids
        .iter()
        .map(|id| json!({"clientID": id.client_id, "id": id.id}))
        .collect();
    let body = match status {
        Some(status) => json!({
            "kind": "PushFailed", "origin": "zeroCache", "reason": "http",
            "status": status, "bodyPreview": preview.unwrap_or(""),
            "mutationIDs": ids, "message": message,
        }),
        None => json!({
            "kind": "PushFailed", "origin": "zeroCache", "reason": "internal",
            "mutationIDs": ids, "message": message,
        }),
    };
    frame("error", body)
}

/// `error` for the deprecated per-mutation spelling of an out-of-order
/// mutation. Current zero-server returns this as a top-level `PushFailed`, but
/// zero-cache still recognizes the old result and promotes it to the same
/// fatal downstream error.
pub fn out_of_order_push(mutation_ids: &[MutationId], details: Option<&Json>) -> String {
    let ids: Vec<Json> = mutation_ids
        .iter()
        .map(|id| json!({"clientID": id.client_id, "id": id.id}))
        .collect();
    let mut body = json!({
        "kind": "PushFailed", "origin": "server", "reason": "oooMutation",
        "mutationIDs": ids, "message": "mutation was out of order",
    });
    if let Some(details) = details {
        body["details"] = details.clone();
    }
    frame("error", body)
}

/// `error` for a query transform the application server could not do.
pub fn transform_failed(query_ids: &[String], status: Option<u16>, message: &str) -> String {
    let body = match status {
        Some(status) => json!({
            "kind": "TransformFailed", "origin": "zeroCache", "reason": "http",
            "status": status, "queryIDs": query_ids, "message": message,
        }),
        None => json!({
            "kind": "TransformFailed", "origin": "zeroCache", "reason": "internal",
            "queryIDs": query_ids, "message": message,
        }),
    };
    frame("error", body)
}

/// `transformError`: queries the application server, or this server,
/// could not turn into something to run.
pub fn transform_error(errors: Vec<Json>) -> String {
    frame("transformError", Json::Array(errors))
}

/// One entry of a `transformError`, as an application error.
pub fn errored_query(id: &str, name: &str, message: &str) -> Json {
    json!({"error": "app", "id": id, "name": name, "message": message})
}

/// `deleteClients`: the clients the server dropped.
pub fn delete_clients(deleted: &DeleteClients) -> String {
    frame(
        "deleteClients",
        json!({"clientIDs": deleted.client_ids, "clientGroupIDs": deleted.client_group_ids}),
    )
}

/// The name of the custom mutation that asks the application server to
/// delete mutation results a client has received (Zero's
/// `CLEANUP_RESULTS_MUTATION_NAME`); it bumps no mutation id.
pub const CLEANUP_RESULTS: &str = "_zero_cleanupResults";

/// A `mutationsPatch` entry recording the result of `client`'s mutation
/// `id`, as zero-cache words it: the client settles the mutation's
/// promise with it.
pub fn result_put(client: &str, id: i64, result: Json) -> Json {
    json!({"op": "put", "mutation": {"id": {"clientID": client, "id": id}, "result": result}})
}

/// A `mutationsPatch` entry removing the result of `client`'s mutation
/// `id` once it has been cleaned up.
pub fn result_del(client: &str, id: i64) -> Json {
    json!({"op": "del", "id": {"clientID": client, "id": id}})
}

/// The push body asking the application server to delete the results of
/// `upto.client_id`'s mutations up to `upto.id` in `group`, the one
/// zero-cache sends when a client acknowledges them.
pub fn cleanup_results(group: &str, upto: &MutationId) -> Json {
    cleanup_push(
        group,
        &upto.client_id,
        json!({
            "type": "single", "clientGroupID": group,
            "clientID": upto.client_id, "upToMutationID": upto.id,
        }),
        format!("cleanup-{group}-{}-{}", upto.client_id, upto.id),
    )
}

/// The push body asking the application server to delete every result of
/// `clients` in `group`, the one zero-cache sends when clients are
/// deleted; `None` for no clients.
pub fn cleanup_clients(group: &str, clients: &[String]) -> Option<Json> {
    let first = clients.first()?;
    let now = now_millis();
    Some(cleanup_push(
        group,
        first,
        json!({"type": "bulk", "clientGroupID": group, "clientIDs": clients}),
        format!("cleanup-bulk-{group}-{now}"),
    ))
}

/// One cleanup push: a single custom mutation of id 0 carrying `args`.
fn cleanup_push(group: &str, client: &str, args: Json, request_id: String) -> Json {
    let now = now_millis();
    json!({
        "clientGroupID": group,
        "mutations": [{
            "type": "custom", "id": 0, "clientID": client,
            "name": CLEANUP_RESULTS, "args": [args], "timestamp": now,
        }],
        "pushVersion": 1,
        "timestamp": now,
        "requestID": request_id,
    })
}

/// Milliseconds since the epoch, now.
fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|since| since.as_millis() as u64)
        .unwrap_or(0)
}

/// `pull`: the last mutation ids of a client group.
pub fn pull_response(cookie: &str, request_id: &str, lmids: &HashMap<String, i64>) -> String {
    frame(
        "pull",
        json!({"cookie": cookie, "requestID": request_id, "lastMutationIDChanges": lmids}),
    )
}

/// `pokeStart`.
pub fn poke_start(poke_id: &str, base_cookie: Option<&str>) -> String {
    frame(
        "pokeStart",
        json!({"pokeID": poke_id, "baseCookie": base_cookie}),
    )
}

/// `pokeEnd`.
pub fn poke_end(poke_id: &str, cookie: &str) -> String {
    frame("pokeEnd", json!({"pokeID": poke_id, "cookie": cookie}))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A client's acknowledgement of its mutation results is read with the
    /// mutation it reaches.
    #[test]
    fn an_acknowledgement_of_results_is_read() {
        let ack =
            parse_upstream(r#"["ackMutationResponses",{"clientID":"c1","id":7}]"#).expect("parsed");
        let Upstream::AckMutationResponses(upto) = ack else {
            panic!("{ack:?}");
        };
        assert_eq!(
            upto,
            MutationId {
                client_id: "c1".to_owned(),
                id: 7
            }
        );
        assert!(parse_upstream(r#"["ackMutationResponses",{"id":7}]"#).is_err());
    }

    /// The results patch and the cleanup pushes are the ones zero-cache
    /// sends: the entries the client's poke handler turns into its result
    /// records, and the `_zero_cleanupResults` mutation (single for an
    /// acknowledgement, bulk for deleted clients) the application server
    /// deletes them on.
    #[test]
    fn results_and_their_cleanup_are_worded_as_zero_cache_words_them() {
        let error = json!({"error": "app", "message": "Conversation not found"});
        assert_eq!(
            result_put("c1", 7, error.clone()),
            json!({"op": "put", "mutation": {"id": {"clientID": "c1", "id": 7}, "result": error}})
        );
        assert_eq!(
            result_del("c1", 7),
            json!({"op": "del", "id": {"clientID": "c1", "id": 7}})
        );
        let single = cleanup_results(
            "g1",
            &MutationId {
                client_id: "c1".to_owned(),
                id: 7,
            },
        );
        assert_eq!(single["clientGroupID"], "g1");
        assert_eq!(single["pushVersion"], 1);
        assert_eq!(single["requestID"], "cleanup-g1-c1-7");
        assert_eq!(single["mutations"][0]["name"], "_zero_cleanupResults");
        assert_eq!(single["mutations"][0]["type"], "custom");
        assert_eq!(single["mutations"][0]["id"], 0);
        assert_eq!(single["mutations"][0]["clientID"], "c1");
        assert_eq!(
            single["mutations"][0]["args"],
            json!([{"type": "single", "clientGroupID": "g1", "clientID": "c1", "upToMutationID": 7}])
        );
        let clients = vec!["c1".to_owned(), "c2".to_owned()];
        let bulk = cleanup_clients("g1", &clients).expect("clients");
        assert_eq!(bulk["mutations"][0]["clientID"], "c1");
        assert_eq!(
            bulk["mutations"][0]["args"],
            json!([{"type": "bulk", "clientGroupID": "g1", "clientIDs": ["c1", "c2"]}])
        );
        assert!(
            bulk["requestID"]
                .as_str()
                .is_some_and(|id| id.starts_with("cleanup-bulk-g1-"))
        );
        assert!(cleanup_clients("g1", &[]).is_none());
    }

    #[test]
    fn deprecated_out_of_order_result_becomes_push_failed() {
        let ids = vec![MutationId {
            client_id: "a".to_owned(),
            id: 3,
        }];
        let details = json!("expected mutation 2");
        let frame: Json = serde_json::from_str(&out_of_order_push(&ids, Some(&details))).unwrap();
        assert_eq!(frame[0], "error");
        assert_eq!(frame[1]["kind"], "PushFailed");
        assert_eq!(frame[1]["origin"], "server");
        assert_eq!(frame[1]["reason"], "oooMutation");
        assert_eq!(frame[1]["mutationIDs"], json!([{"clientID": "a", "id": 3}]));
        assert_eq!(frame[1]["details"], details);
    }

    /// Cookies order like numbers: length prefix, then base 36.
    #[test]
    fn cookies_are_lexicographic_versions() {
        assert_eq!(cookie(0), "00");
        assert_eq!(cookie(35), "0z");
        assert_eq!(cookie(36), "110");
        assert!(cookie(35) < cookie(36));
        assert!(cookie(1295) < cookie(1296));
        for version in [0, 1, 35, 36, 1295, 1296, 987_654_321] {
            assert_eq!(version_of(&cookie(version)), Some(version));
        }
        for foreign in ["", "0", "1z", "00z", "0Z", "abc:01", "9"] {
            assert_eq!(version_of(foreign), None, "{foreign}");
        }
    }

    /// The handshake header round-trips the first message and the token.
    #[test]
    fn handshake_header_decodes() {
        let payload = r#"{"initConnectionMessage":["initConnection",{"desiredQueriesPatch":[{"op":"put","hash":"h1","name":"q","args":[1],"ttl":300000}]}],"authToken":"t"}"#;
        let encoded = base64::engine::general_purpose::STANDARD.encode(payload.as_bytes());
        let header =
            percent_encoding::utf8_percent_encode(&encoded, percent_encoding::NON_ALPHANUMERIC)
                .to_string();
        let handshake = decode_handshake(&header).unwrap();
        assert_eq!(handshake.auth_token.as_deref(), Some("t"));
        let init = handshake.init.unwrap();
        assert_eq!(init.desired_queries_patch.len(), 1);
        assert!(
            matches!(&init.desired_queries_patch[0], QueryPatchOp::Put { hash, name: Some(name), .. } if hash == "h1" && name == "q")
        );
    }

    /// A client's own endpoints and ASTs are accepted on the wire and
    /// dropped: the handshake still decodes, and nothing of them survives
    /// into the parsed message. The endpoints are the server's
    /// configuration and the AST is the application server's transform.
    #[test]
    fn client_endpoints_and_asts_are_ignored() {
        let payload = r#"{"initConnectionMessage":["initConnection",{"userQueryURL":"https://attacker.example/query","userQueryHeaders":{"X-Evil":"1"},"userPushURL":"https://attacker.example/push","userPushHeaders":{"X-Evil":"1"},"desiredQueriesPatch":[{"op":"put","hash":"h1","name":"q","args":[1],"ast":{"table":"users","where":null}}]}],"authToken":"t"}"#;
        let encoded = base64::engine::general_purpose::STANDARD.encode(payload.as_bytes());
        let header =
            percent_encoding::utf8_percent_encode(&encoded, percent_encoding::NON_ALPHANUMERIC)
                .to_string();
        let init = decode_handshake(&header).unwrap().init.unwrap();
        let debug = format!("{init:?}");
        assert!(!debug.contains("attacker.example"), "{debug}");
        assert!(!debug.contains("X-Evil"), "{debug}");
        assert!(!debug.contains("users"), "{debug}");
        assert!(
            matches!(&init.desired_queries_patch[0], QueryPatchOp::Put { hash, name: Some(name), args: Some(args), .. } if hash == "h1" && name == "q" && args.len() == 1)
        );
    }

    /// Upstream messages parse by tag.
    #[test]
    fn upstream_messages_parse() {
        assert!(matches!(
            parse_upstream(r#"["ping",{}]"#),
            Ok(Upstream::Ping)
        ));
        let push = parse_upstream(r#"["push",{"clientGroupID":"g","mutations":[{"type":"custom","id":3,"clientID":"c","name":"m","args":[],"timestamp":1}],"pushVersion":1,"requestID":"r","timestamp":1}]"#).unwrap();
        let Upstream::Push(push) = push else {
            panic!("push")
        };
        assert_eq!(push.client_group_id, "g");
        assert_eq!(push.mutation_ids[0].id, 3);
        assert!(
            matches!(parse_upstream(r#"["changeDesiredQueries",{"desiredQueriesPatch":[{"op":"del","hash":"h"}]}]"#), Ok(Upstream::ChangeDesiredQueries(ops)) if ops.len() == 1)
        );
        assert!(matches!(
            parse_upstream(r#"["inspect",{}]"#),
            Ok(Upstream::Other(_))
        ));
        assert!(parse_upstream("nope").is_err());
    }
}
