package cmd

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/spf13/cobra"
	"golang.org/x/term"

	"ironstock.app/cli/internal/client"
	"ironstock.app/cli/internal/config"
)

var loginCmd = &cobra.Command{
	Use:   "login",
	Short: "Authenticate with an IronStock server",
	Long: `Authenticate with an IronStock server and store credentials locally.

The access and refresh tokens are saved to ~/.config/ironstock/.tokens
(mode 0600). The master password is NOT saved — it is only used to derive
the client-side encryption key (KEK) in memory for the current session.`,
	RunE: runLogin,
}

var loginFlags struct {
	ServerURL string
	Username  string
}

func init() {
	loginCmd.Flags().StringVarP(&loginFlags.ServerURL, "server", "s", "",
		"IronStock server URL (e.g. https://ironstock.example.com)")
	loginCmd.Flags().StringVarP(&loginFlags.Username, "user", "u", "",
		"Username")
}

func runLogin(cmd *cobra.Command, _ []string) error {
	ctx := context.Background()

	serverURL := loginFlags.ServerURL
	if serverURL == "" {
		serverURL = promptString("Server URL")
	}
	serverURL = strings.TrimRight(serverURL, "/")

	username := loginFlags.Username
	if username == "" {
		username = promptString("Username")
	}

	password, err := promptPassword("Master password")
	if err != nil {
		return fmt.Errorf("login: read password: %w", err)
	}

	c := client.NewWithCreds(serverURL)

	// Step 1: Login with username + password.
	type loginReq struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	type loginResp struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		TOTPRequired bool   `json:"totp_required"`
		TmpToken     string `json:"tmp_token"`
	}

	resp, err := c.Do(ctx, http.MethodPost, "/api/v1/auth/login",
		loginReq{Username: username, Password: password})
	if err != nil {
		return fmt.Errorf("login: %w", err)
	}
	defer resp.Body.Close()

	var lr loginResp
	dec := json.NewDecoder(resp.Body)
	if err := dec.Decode(&lr); err != nil {
		return fmt.Errorf("login: decode response: %w", err)
	}
	if resp.StatusCode == http.StatusUnauthorized {
		return fmt.Errorf("login: invalid username or password")
	}
	if resp.StatusCode >= 400 {
		return fmt.Errorf("login: server error %d", resp.StatusCode)
	}

	// Step 2: TOTP if required.
	if lr.TOTPRequired {
		totp := promptString("TOTP code (6 digits)")
		type totpReq struct {
			Code string `json:"code"`
		}

		// Set the tmp_token as a Bearer token for the TOTP verify call.
		c.AccessToken = lr.TmpToken

		totpResp, err := c.Do(ctx, http.MethodPost, "/api/v1/auth/totp/verify",
			totpReq{Code: totp})
		if err != nil {
			return fmt.Errorf("login: totp: %w", err)
		}
		defer totpResp.Body.Close()
		if totpResp.StatusCode >= 400 {
			return fmt.Errorf("login: totp verification failed")
		}
		var tr loginResp
		if err := json.NewDecoder(totpResp.Body).Decode(&tr); err != nil {
			return fmt.Errorf("login: totp decode: %w", err)
		}
		lr.AccessToken = tr.AccessToken
		lr.RefreshToken = tr.RefreshToken
	}

	// Save config.
	if err := config.Save(&config.Config{
		ServerURL: serverURL,
		Username:  username,
	}); err != nil {
		return fmt.Errorf("login: save config: %w", err)
	}

	// Save tokens (0600).
	if err := config.SaveTokens(lr.AccessToken, lr.RefreshToken); err != nil {
		return fmt.Errorf("login: save tokens: %w", err)
	}

	if !globalFlags.Quiet {
		fmt.Fprintf(os.Stdout, "✓ Logged in to %s as %s\n", serverURL, username)
	}
	return nil
}

// ---------- prompt helpers ----------

func promptString(label string) string {
	fmt.Fprintf(os.Stderr, "%s: ", label)
	var val string
	fmt.Scanln(&val)
	return strings.TrimSpace(val)
}

func promptPassword(label string) (string, error) {
	fmt.Fprintf(os.Stderr, "%s: ", label)
	if term.IsTerminal(int(os.Stdin.Fd())) {
		b, err := term.ReadPassword(int(os.Stdin.Fd()))
		fmt.Fprintln(os.Stderr)
		if err != nil {
			return "", err
		}
		return string(b), nil
	}
	// Non-TTY fallback (CI, piped input).
	var pw string
	fmt.Scanln(&pw)
	return strings.TrimSpace(pw), nil
}
