package auth

import (
	"context"
	"errors"
	"strings"

	"github.com/Tornado2026-team-j/Samurai-meet/backend/internal/config"
	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

type GoogleIdentity struct {
	Subject       string
	Email         string
	DisplayName   string
	EmailVerified bool
}
type GoogleOIDC struct {
	oauthConfig oauth2.Config
	verifier    *oidc.IDTokenVerifier
}

func NewGoogleOIDC(ctx context.Context, cfg config.GoogleOIDCConfig) (*GoogleOIDC, error) {
	if cfg.ClientID == "" || cfg.ClientSecret == "" || cfg.RedirectURI == "" {
		return nil, errors.New("Google OAuth configuration is incomplete")
	}
	provider, err := oidc.NewProvider(ctx, "https://accounts.google.com")
	if err != nil {
		return nil, err
	}
	return &GoogleOIDC{oauth2.Config{ClientID: cfg.ClientID, ClientSecret: cfg.ClientSecret, RedirectURL: cfg.RedirectURI, Endpoint: provider.Endpoint(), Scopes: []string{oidc.ScopeOpenID, "email", "profile"}}, provider.Verifier(&oidc.Config{ClientID: cfg.ClientID})}, nil
}
func (g *GoogleOIDC) AuthorizationURL(state, codeChallenge string) string {
	return g.oauthConfig.AuthCodeURL(state, oauth2.AccessTypeOffline, oauth2.SetAuthURLParam("code_challenge", codeChallenge), oauth2.SetAuthURLParam("code_challenge_method", "S256"))
}
func (g *GoogleOIDC) Exchange(ctx context.Context, code, codeVerifier string) (GoogleIdentity, error) {
	token, err := g.oauthConfig.Exchange(ctx, code, oauth2.SetAuthURLParam("code_verifier", codeVerifier))
	if err != nil {
		return GoogleIdentity{}, err
	}
	raw, ok := token.Extra("id_token").(string)
	if !ok || raw == "" {
		return GoogleIdentity{}, errors.New("Google response does not contain an ID token")
	}
	id, err := g.verifier.Verify(ctx, raw)
	if err != nil {
		return GoogleIdentity{}, err
	}
	var claims struct {
		Subject       string `json:"sub"`
		Email         string `json:"email"`
		Name          string `json:"name"`
		EmailVerified bool   `json:"email_verified"`
	}
	if err := id.Claims(&claims); err != nil {
		return GoogleIdentity{}, err
	}
	if claims.Subject == "" {
		return GoogleIdentity{}, errors.New("Google ID token has no subject")
	}
	displayName := strings.TrimSpace(claims.Name)
	if displayName == "" {
		displayName = strings.TrimSpace(claims.Email)
	}
	return GoogleIdentity{Subject: claims.Subject, Email: claims.Email, DisplayName: displayName, EmailVerified: claims.EmailVerified}, nil
}
