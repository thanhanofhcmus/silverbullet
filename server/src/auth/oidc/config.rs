use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    #[serde(default)]
    pub provider_id: String,
    pub issuer: String,
    pub central_origin: String,
    pub client_id: String,
    pub client_secret: String,
    #[serde(default)]
    pub workspace_domain: String,
    /// How to authenticate at the token endpoint: `auto` (default),
    /// `client_secret_post`, or `client_secret_basic`.
    #[serde(default)]
    pub token_auth_method: TokenAuthMethod,
    pub button_label: String,
}

/// Token-endpoint client authentication method.
///
/// The provider's discovery document advertises which methods it supports
/// *server-wide*, which says nothing about how an individual client is
/// registered. Authelia, for example, advertises both `client_secret_basic`
/// and `client_secret_post` while each client registration pins exactly one,
/// so guessing from discovery alone fails whenever the guess disagrees with
/// the registration. `auto` therefore follows the registration convention that
/// is the safe default behind reverse proxies, and the other variants let an
/// operator pin the method explicitly.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TokenAuthMethod {
    #[default]
    Auto,
    #[serde(rename = "client_secret_post")]
    ClientSecretPost,
    #[serde(rename = "client_secret_basic")]
    ClientSecretBasic,
}

impl ProviderConfig {
    pub fn validate(&mut self) -> Result<(), String> {
        self.workspace_domain = self.workspace_domain.trim().to_ascii_lowercase();
        if !self.workspace_domain.is_empty() {
            self.issuer = "https://accounts.google.com".into();
            if self.workspace_domain.contains(['/', '@', ':', ' ']) {
                return Err("Enter your Google Workspace domain".into());
            }
        }
        let central = validated_url(&self.central_origin)?;
        // The central login address may carry a path prefix (e.g.
        // `https://host/notes`) so the whole central-auth surface can be served
        // under a server-wide prefix. Normalize to scheme://host[:port][/prefix]
        // with no trailing slash.
        let prefix = central.path().trim_end_matches('/');
        self.central_origin = if prefix.is_empty() {
            central.origin().ascii_serialization()
        } else {
            format!("{}{prefix}", central.origin().ascii_serialization())
        };
        validated_url(&self.issuer)?;
        if self.client_id.trim().is_empty() || self.client_secret.is_empty() {
            return Err("Client ID and client secret are required".into());
        }
        if self.button_label.trim().is_empty() || self.button_label.len() > 100 {
            return Err("Enter a login button label of at most 100 characters".into());
        }
        Ok(())
    }

    pub fn callback_url(&self) -> String {
        format!("{}/.auth/central/oidc/callback", self.central_origin)
    }

    pub fn public_json(&self) -> serde_json::Value {
        let mut value = serde_json::to_value(self).expect("provider configuration serializes");
        value.as_object_mut().unwrap().remove("clientSecret");
        value["hasClientSecret"] = (!self.client_secret.is_empty()).into();
        value
    }
}

pub fn validated_url(value: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(value).map_err(|_| "Enter a valid HTTPS URL")?;
    let loopback = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if (url.scheme() != "https" && !(url.scheme() == "http" && loopback))
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Use HTTPS without credentials, query parameters, or fragments (HTTP is allowed only on localhost)".into());
    }
    Ok(url)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn config() -> ProviderConfig {
        ProviderConfig {
            provider_id: "pocket".into(),
            issuer: "https://identity.test".into(),
            central_origin: "https://login.sb.test".into(),
            client_id: "client".into(),
            client_secret: "secret".into(),
            workspace_domain: String::new(),
            token_auth_method: TokenAuthMethod::Auto,
            button_label: "Continue with Pocket ID".into(),
        }
    }
    #[test]
    fn token_auth_method_defaults_to_auto() {
        let mut cfg = config();
        assert_eq!(cfg.token_auth_method, TokenAuthMethod::Auto);
        cfg.validate().unwrap();
        assert_eq!(cfg.token_auth_method, TokenAuthMethod::Auto);
    }

    #[test]
    fn token_auth_method_round_trips_through_json() {
        // The dashboard persists this alongside the other provider fields, so
        // it must survive a serialize/deserialize cycle under its documented
        // snake_case spelling.
        let mut cfg = config();
        cfg.token_auth_method = TokenAuthMethod::ClientSecretPost;
        let json = serde_json::to_value(&cfg).unwrap();
        assert_eq!(json["tokenAuthMethod"], "client_secret_post");
        let back: ProviderConfig = serde_json::from_value(json).unwrap();
        assert_eq!(back.token_auth_method, TokenAuthMethod::ClientSecretPost);
    }

    #[test]
    fn token_auth_method_is_omitted_safely_when_absent() {
        // Older saved drafts predate the field; they must load as `auto`.
        let json = serde_json::json!({
            "issuer": "https://identity.test",
            "centralOrigin": "https://login.sb.test",
            "clientId": "client",
            "clientSecret": "secret",
            "buttonLabel": "Continue",
        });
        let cfg: ProviderConfig = serde_json::from_value(json).unwrap();
        assert_eq!(cfg.token_auth_method, TokenAuthMethod::Auto);
    }

    #[test]
    fn central_address_rejects_userinfo_query_and_insecure_hosts() {
        for origin in [
            "http://login.sb.test",
            "https://user@login.sb.test",
            "https://login.sb.test?x=1",
            "https://login.sb.test/#fragment",
        ] {
            let mut c = config();
            c.central_origin = origin.into();
            assert!(c.validate().is_err(), "{origin}");
        }
    }

    #[test]
    fn central_address_accepts_a_path_prefix_and_normalizes_it() {
        let mut c = config();
        c.central_origin = "https://host.test/notes/".into();
        c.validate().unwrap();
        assert_eq!(c.central_origin, "https://host.test/notes");
        assert_eq!(
            c.callback_url(),
            "https://host.test/notes/.auth/central/oidc/callback"
        );

        let mut bare = config();
        bare.central_origin = "https://host.test".into();
        bare.validate().unwrap();
        assert_eq!(bare.central_origin, "https://host.test");
        assert_eq!(
            bare.callback_url(),
            "https://host.test/.auth/central/oidc/callback"
        );
    }
    #[test]
    fn workspace_policy_selects_google_and_normalizes_the_domain() {
        let mut c: ProviderConfig = serde_json::from_value(serde_json::json!({
            "issuer": "https://identity.test",
            "centralOrigin": "https://login.sb.test",
            "clientId": "client",
            "clientSecret": "secret",
            "workspaceDomain": "Example.COM",
            "buttonLabel": "Sign in with Google"
        }))
        .unwrap();
        c.validate().unwrap();
        assert_eq!(c.issuer, "https://accounts.google.com");
        assert_eq!(c.workspace_domain, "example.com");
    }
    #[test]
    fn missing_credentials_are_rejected() {
        let mut c = config();
        c.client_secret.clear();
        assert!(c.validate().is_err());
    }
}
