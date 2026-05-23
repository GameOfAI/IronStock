package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
)

// Version is set at build time via -ldflags.
var Version = "dev"

var versionCmd = &cobra.Command{
	Use:   "version",
	Short: "Print the ironstock CLI version",
	Run: func(cmd *cobra.Command, _ []string) {
		fmt.Println("ironstock", Version)
	},
}
