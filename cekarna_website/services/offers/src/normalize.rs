use sha2::{Digest, Sha256};
use unicode_normalization::{UnicodeNormalization, char::is_combining_mark};
pub fn norm(value: &str) -> String {
    let plain: String = value.nfd().filter(|c| !is_combining_mark(*c)).collect();
    plain
        .to_lowercase()
        .replace("(h/f)", "")
        .replace("(f/h)", "")
        .replace("h/f", "")
        .replace("f/h", "")
        .replace("h-f", "")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_matches(|c: char| !c.is_alphanumeric())
        .to_string()
}
pub fn company_norm(value: &str) -> String {
    let mut n = norm(value);
    for suffix in [" sasu", " sarl", " sas", " sa"] {
        if n.ends_with(suffix) {
            n.truncate(n.len() - suffix.len());
            break;
        }
    }
    n
}
pub fn fingerprint(title: &str, company: &str, location: &str) -> String {
    format!(
        "{:x}",
        Sha256::digest(
            format!(
                "{}|{}|{}",
                norm(title),
                company_norm(company),
                norm(location)
            )
            .as_bytes()
        )
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn normalise() {
        assert_eq!(norm(" Développeur (H/F) "), "developpeur");
        assert_eq!(company_norm("Exemple SAS"), "exemple");
    }
    #[test]
    fn stable() {
        assert_eq!(
            fingerprint("Dev H/F", "ACME SAS", "Lyon"),
            fingerprint("dev", "Acme", "LYON")
        );
    }
}
