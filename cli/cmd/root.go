// Package cmd provides the cobra command tree for the ironstock CLI.
package cmd

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

// globalFlags are flags shared across all commands.
var globalFlags struct {
	// JSONOutput enables machine-readable JSON output.
	JSONOutput bool
	// Quiet suppresses all output except the raw data (script-friendly).
	Quiet bool
	// ConfigFile overrides the default config location.
	ConfigFile string
}

// rootCmd is the base command when called without any subcommands.
var rootCmd = &cobra.Command{
	Use:   "ironstock",
	Short: "IronStock CLI — credential vault on the command line",
	Long: `ironstock is the command line interface for IronStock, the self-hosted
credential and infrastructure inventory vault.

Usage examples:
  ironstock login
  ironstock get prod-db --field password --clip
  ironstock search "kubernetes"
  ironstock list items /ops/databases
  ironstock create item --name "Redis Cache" --type server
  ironstock export --format zip --output backup.zip

Run 'ironstock <command> --help' for more information.`,
	SilenceUsage:  true,
	SilenceErrors: true,
}

// Execute runs the root command.
func Execute() {
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, "Error:", err)
		os.Exit(1)
	}
}

func init() {
	rootCmd.PersistentFlags().BoolVar(&globalFlags.JSONOutput, "json", false,
		"Output as JSON (machine-readable)")
	rootCmd.PersistentFlags().BoolVarP(&globalFlags.Quiet, "quiet", "q", false,
		"Suppress headers and labels (script-friendly)")
	rootCmd.PersistentFlags().StringVar(&globalFlags.ConfigFile, "config", "",
		"Config file path (default: $HOME/.config/ironstock/config.json)")

	// Register sub-commands.
	rootCmd.AddCommand(
		loginCmd,
		logoutCmd,
		getCmd,
		searchCmd,
		listCmd,
		createCmd,
		updateCmd,
		exportCmd,
		relationshipCmd,
		versionCmd,
	)
}
