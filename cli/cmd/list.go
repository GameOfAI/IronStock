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

var listCmd = &cobra.Command{
	Use:   "list",
	Short: "List folders or items",
	Long:  `List folders or items from the vault.`,
}

var listFoldersCmd = &cobra.Command{
	Use:   "folders",
	Short: "List all folders",
	RunE:  runListFolders,
}

var listItemsCmd = &cobra.Command{
	Use:   "items [folder-id]",
	Short: "List items (optionally filtered by folder)",
	RunE:  runListItems,
}

var listFlags struct {
	Limit int
}

func init() {
	listCmd.AddCommand(listFoldersCmd, listItemsCmd)
	listItemsCmd.Flags().IntVar(&listFlags.Limit, "limit", 50, "Maximum items to show")
}

type folder struct {
	ID       string `json:"id"`
	Name     string `json:"name_plain"`
	ParentID string `json:"parent_id"`
}

func runListFolders(cmd *cobra.Command, _ []string) error {
	ctx := context.Background()
	c, err := client.New()
	if err != nil {
		return err
	}

	resp, err := c.Do(ctx, http.MethodGet, "/api/v1/folders/", nil)
	if err != nil {
		return fmt.Errorf("list folders: %w", err)
	}

	var result struct {
		Folders []folder `json:"folders"`
	}
	if err := client.JSON(resp, &result); err != nil {
		return fmt.Errorf("list folders: %w", err)
	}

	if globalFlags.JSONOutput {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(result)
	}

	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	if !globalFlags.Quiet {
		fmt.Fprintln(w, "NAME\tID\tPARENT")
	}
	for _, f := range result.Folders {
		fmt.Fprintf(w, "%s\t%s\t%s\n", f.Name, f.ID, f.ParentID)
	}
	return w.Flush()
}

func runListItems(cmd *cobra.Command, args []string) error {
	ctx := context.Background()
	c, err := client.New()
	if err != nil {
		return err
	}

	q := url.Values{"limit": {fmt.Sprintf("%d", listFlags.Limit)}}
	if len(args) > 0 {
		q.Set("folder_id", args[0])
	}

	resp, err := c.Do(ctx, http.MethodGet, "/api/v1/items/?"+q.Encode(), nil)
	if err != nil {
		return fmt.Errorf("list items: %w", err)
	}

	var result struct {
		Items []item `json:"items"`
		Total int    `json:"total"`
	}
	if err := client.JSON(resp, &result); err != nil {
		return fmt.Errorf("list items: %w", err)
	}

	if globalFlags.JSONOutput {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(result)
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
