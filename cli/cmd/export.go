package cmd

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"github.com/spf13/cobra"

	"ironstock.app/cli/internal/client"
)

var exportCmd = &cobra.Command{
	Use:   "export",
	Short: "Export the vault (admin only)",
	Long: `Export vault items as a ZIP file (admin only).

The export is a server-side plaintext dump (name, metadata, encrypted field
ciphertexts). For an E2E-encrypted export use the web UI's "Şifreli ZIP Export".

Examples:
  ironstock export --output backup.zip
  ironstock export --scope folder:<folder-id> --output ops.zip`,
	RunE: runExport,
}

var exportFlags struct {
	Output string
	Scope  string
}

func init() {
	exportCmd.Flags().StringVarP(&exportFlags.Output, "output", "o", "",
		"Output file path (default: ironstock-export-<timestamp>.zip)")
	exportCmd.Flags().StringVar(&exportFlags.Scope, "scope", "all",
		"Export scope: all | folder:<uuid> | user:<uuid>")
}

func runExport(cmd *cobra.Command, _ []string) error {
	ctx := context.Background()

	c, err := client.New()
	if err != nil {
		return err
	}

	outPath := exportFlags.Output
	if outPath == "" {
		outPath = fmt.Sprintf("ironstock-export-%s.zip", time.Now().Format("20060102-150405"))
	}

	if !globalFlags.Quiet {
		fmt.Fprintf(os.Stderr, "Exporting (scope: %s)…\n", exportFlags.Scope)
	}

	resp, err := c.Do(ctx, http.MethodGet,
		"/api/v1/admin/export?scope="+exportFlags.Scope, nil)
	if err != nil {
		return fmt.Errorf("export: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		var apiErr client.APIError
		apiErr.StatusCode = resp.StatusCode
		apiErr.Message = http.StatusText(resp.StatusCode)
		return &apiErr
	}

	f, err := os.Create(outPath)
	if err != nil {
		return fmt.Errorf("export: create file: %w", err)
	}
	defer f.Close()

	n, err := io.Copy(f, resp.Body)
	if err != nil {
		return fmt.Errorf("export: write: %w", err)
	}

	if !globalFlags.Quiet {
		fmt.Fprintf(os.Stdout, "Exported %d bytes to %s\n", n, outPath)
	}
	return nil
}
