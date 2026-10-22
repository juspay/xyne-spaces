//! Where in the source's history a write or a storage read sits: one WAL
//! location ([`Lsn`]) for both. The engine itself never compares
//! locations; the runtime does, to bring a read's result up to the point
//! the engine has reached before the engine sees it (see `sync::Runtime`).

use std::fmt;

use super::frame::{DataFrameKey, DataFrameRow};

/// A WAL location: the 64-bit form of Postgres's `X/Y`. A write carries
/// the location of its transaction's commit; a read carries the location
/// its snapshot reflects every commit up to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default)]
pub struct Lsn(pub u64);

impl Lsn {
    /// Parse Postgres's `X/Y` spelling (both halves hexadecimal).
    pub fn parse(text: &str) -> Option<Lsn> {
        let (high, low) = text.trim().split_once('/')?;
        let high = u64::from_str_radix(high, 16).ok()?;
        let low = u64::from_str_radix(low, 16).ok()?;
        Some(Lsn((high << 32) | low))
    }
}

impl fmt::Display for Lsn {
    /// Postgres's `X/Y` spelling.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:X}/{:X}", self.0 >> 32, self.0 & 0xFFFF_FFFF)
    }
}

/// The result of one storage read: the rows, and the location the read's
/// snapshot reflects every commit up to (and nothing beyond).
#[derive(Debug, Clone, PartialEq)]
pub struct Snapshot {
    pub rows: Vec<(DataFrameKey, DataFrameRow)>,
    pub at: Lsn,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `X/Y` parses hexadecimal halves into one ordered number and prints
    /// back the same way.
    #[test]
    fn lsn_round_trips() {
        let lsn = Lsn::parse("1/A0").unwrap();
        assert_eq!(lsn, Lsn((1 << 32) | 0xA0));
        assert_eq!(lsn.to_string(), "1/A0");
        assert!(Lsn::parse("0/FFFFFFFF").unwrap() < Lsn::parse("1/0").unwrap());
        assert!(Lsn::parse("nonsense").is_none());
    }
}
