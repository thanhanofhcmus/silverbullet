//! Helpers for serving the standalone admin shells (dashboard, setup, central
//! auth) from a prefixed mount. Their bundled HTML hardcodes a root-absolute
//! `<base href="/.dashboard/">`; when the server is mounted under a prefix
//! (e.g. `/notes`) that base must be rewritten so the client, which resolves
//! all of its URLs against `document.baseURI`, talks to the prefixed surface.

/// Rewrite the shell's `<base href="{surface}/" />` to `{prefix}{surface}/`.
///
/// `surface` is the root-relative mount (e.g. `/.dashboard`); `prefix` is the
/// server-wide prefix (e.g. `/notes`, or empty for the origin root). Only the
/// first `<base ...>` tag is touched; if none is found the document is
/// returned unchanged.
pub fn rewrite_base_href(html: &[u8], surface: &str, prefix: &str) -> Vec<u8> {
    if prefix.is_empty() || prefix == "/" {
        return html.to_vec();
    }
    let Ok(text) = std::str::from_utf8(html) else {
        return html.to_vec();
    };
    let old = format!("<base href=\"{surface}/\" />");
    let new = format!("<base href=\"{prefix}{surface}/\" />");
    if text.contains(&old) {
        text.replacen(&old, &new, 1).into_bytes()
    } else {
        html.to_vec()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rewrites_dashboard_base_when_prefixed() {
        let html = br#"<head><base href="/.dashboard/" /><title>x</title></head>"#;
        let out = rewrite_base_href(html, "/.dashboard", "/notes");
        let s = std::str::from_utf8(&out).unwrap();
        assert!(s.contains(r#"<base href="/notes/.dashboard/" />"#), "{s}");
    }

    #[test]
    fn noop_when_prefix_empty() {
        let html = br#"<base href="/.setup/" />"#;
        assert_eq!(rewrite_base_href(html, "/.setup", ""), html.to_vec());
        assert_eq!(rewrite_base_href(html, "/.setup", "/"), html.to_vec());
    }

    #[test]
    fn unchanged_when_no_base_tag() {
        let html = b"<head></head>";
        assert_eq!(
            rewrite_base_href(html, "/.dashboard", "/notes"),
            html.to_vec()
        );
    }
}
