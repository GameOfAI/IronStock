package cmd

import (
	"context"
	"fmt"
	"net/http"
	"os"

	"github.com/spf13/cobra"

	"ironstock.app/cli/internal/client"
	"ironstock.app/cli/internal/config"
)

var logoutCmd = &cobra.Command{
	Use:   "logout",
	Short: "Sign out and clear local credentials",
	Long: `Sign out of IronStock. The local access and refresh tokens are deleted.
Use --purge to also remove the config file (server URL, username).`,
	RunE: runLogout,
}

var logoutFlags struct {
	Purge bool
}

func init() {
	logoutCmd.Flags().BoolVar(&logoutFlags.Purge, "purge", false,
		"Also delete the config file (server URL, username)")
}

func runLogout(cmd *cobra.Command, _ []string) error {
	ctx := context.Background()

	// Best-effort server-side revocation.
	c, err := client.New()
	if err == nil && c.AccessToken != "" {
		resp, _ := c.Do(ctx, http.MethodPost, "/api/v1/auth/logout", nil)
		if resp != nil {
			resp.Body.Close()
		}
	}

	// Clear local tokens.
	if err := config.ClearTokens(); err != nil {
		return fmt.Errorf("logout: clear tokens: %w", err)
	}

	if logoutFlags.Purge {
		if err := config.Delete(); err != nil {
			return fmt.Errorf("logout: delete config: %w", err)
		}
	}

	if !globalFlags.Quiet {
		fmt.Fprintln(os.Stdout, "✓ Logged out")
	}
	return nil
}
