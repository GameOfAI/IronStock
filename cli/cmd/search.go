package cmd

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"text/tabwriter"

	"github.com/spf13/cobra"

	"ironstock.app/cli/internal/client"
)

var searchCmd = &cobra.Command{
	Use:   "search <query>",
	Short: "Search items in the vault",
	Long: `Search for items matching a query string.

Examples:
  ironstock search kubernetes
  ironstock search "prod db" --fuzzy
  ironstock search nginx --json`,
	Args: cobra.ExactArgs(1),
	RunE: runSearch,
}

var searchFlags struct {
	Fuzzy    bool
	Limit    int
	FolderID string
}

func init() {
	searchCmd.Flags().BoolVar(&searchFlags.Fuzzy, "fuzzy", false,
		"Fuzzy / trigram search (tolerates typos)")
	searchCmd.Flags().IntVar(&searchFlags.Limit, "limit", 20,
		"Maximum results to show")
	searchCmd.Flags().StringVar(&searchFlags.FolderID, "folder", "",
		"Restrict search to a folder (UUID or path)")
}

func runSearch(cmd *cobra.Command, args []string) error {
	ctx := context.Background()

	c, err := client.New()
	if err != nil {
		return err
	}

	q := url.Values{
		"q":     {args[0]},
		"limit": {fmt.Sprintf("%d", searchFlags.Limit)},
	}
	if searchFlags.Fuzzy {
		q.Set("fuzzy", "true")
	}
	if searchFlags.FolderID != "" {
		q.Set("folder_id", searchFlags.FolderID)
	}

	resp, err := c.Do(ctx, http.MethodGet, "/api/v1/items/search?"+q.Encode(), nil)
	if err != nil {
		return fmt.Errorf("search: %w", err)
	}

	var result struct {
		Items []item `json:"items"`
		Total int    `json:"total"`
	}
	if err := client.JSON(resp, &result); err != nil {
		return fmt.Errorf("search: %w", err)
	}

	if globalFlags.JSONOutput {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(result)
	}

	if len(result.Items) == 0 {
		if !globalFlags.Quiet {
			fmt.Fprintln(os.Stderr, "No items found.")
		}
		return nil
	}

	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	if !globalFlags.Quiet {
		fmt.Fprintln(w, "NAME\tTYPE\tID")
	}
	for _, it := range result.Items {
		fmt.Fprintf(w, "%s\t%s\t%s\n", it.Name, it.ItemType, it.ID)
	}
	return w.Flush()
}
