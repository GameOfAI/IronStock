package cmd

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"text/tabwriter"

	"github.com/spf13/cobra"

	"ironstock.app/cli/internal/client"
)

var relationshipCmd = &cobra.Command{
	Use:     "relationship",
	Aliases: []string{"rel"},
	Short:   "Manage item relationships",
}

var relAddCmd = &cobra.Command{
	Use:   "add <source-id> <target-id>",
	Short: "Add a relationship between two items",
	Long: `Create a directed relationship from source to target item.

Relationship types: hosted_on, accessed_via, depends_on, uses_tool,
                    builds_to, scans_with, deploys_to, runs_in

Example:
  ironstock relationship add <app-id> <server-id> --type runs_in`,
	Args: cobra.ExactArgs(2),
	RunE: runRelAdd,
}

var relListCmd = &cobra.Command{
	Use:   "list <item-id>",
	Short: "List relationships for an item",
	Args:  cobra.ExactArgs(1),
	RunE:  runRelList,
}

var relFlags struct {
	Type string
}

func init() {
	relationshipCmd.AddCommand(relAddCmd, relListCmd)
	relAddCmd.Flags().StringVarP(&relFlags.Type, "type", "t", "depends_on",
		"Relationship type")
}

type relationship struct {
	SourceID  string `json:"source_item_id"`
	TargetID  string `json:"target_item_id"`
	RelType   string `json:"relationship_type"`
	TargetName string `json:"target_name_plain"`
}

func runRelAdd(cmd *cobra.Command, args []string) error {
	ctx := context.Background()
	sourceID, targetID := args[0], args[1]

	c, err := client.New()
	if err != nil {
		return err
	}

	payload := map[string]string{
		"target_item_id":    targetID,
		"relationship_type": relFlags.Type,
	}

	resp, err := c.Do(ctx, http.MethodPost,
		"/api/v1/items/"+sourceID+"/relationships", payload)
	if err != nil {
		return fmt.Errorf("relationship add: %w", err)
	}
	if err := client.JSON(resp, nil); err != nil {
		return fmt.Errorf("relationship add: %w", err)
	}

	if !globalFlags.Quiet {
		fmt.Printf("Added %s relationship: %s → %s\n", relFlags.Type, sourceID, targetID)
	}
	return nil
}

func runRelList(cmd *cobra.Command, args []string) error {
	ctx := context.Background()
	itemID := args[0]

	c, err := client.New()
	if err != nil {
		return err
	}

	resp, err := c.Do(ctx, http.MethodGet, "/api/v1/graph/?item_id="+itemID, nil)
	if err != nil {
		return fmt.Errorf("relationship list: %w", err)
	}

	var graph struct {
		Nodes []struct {
			ID   string `json:"id"`
			Name string `json:"name_plain"`
		} `json:"nodes"`
		Edges []struct {
			Source string `json:"source_item_id"`
			Target string `json:"target_item_id"`
			Type   string `json:"relationship_type"`
		} `json:"edges"`
	}
	if err := client.JSON(resp, &graph); err != nil {
		return fmt.Errorf("relationship list: %w", err)
	}

	if globalFlags.JSONOutput {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(graph)
	}

	// Build name lookup.
	names := make(map[string]string, len(graph.Nodes))
	for _, n := range graph.Nodes {
		names[n.ID] = n.Name
	}

	if len(graph.Edges) == 0 {
		if !globalFlags.Quiet {
			fmt.Fprintln(os.Stderr, "No relationships found.")
		}
		return nil
	}

	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	if !globalFlags.Quiet {
		fmt.Fprintln(w, "TYPE\tSOURCE\tTARGET")
	}
	for _, e := range graph.Edges {
		src := names[e.Source]
		if src == "" {
			src = e.Source
		}
		tgt := names[e.Target]
		if tgt == "" {
			tgt = e.Target
		}
		fmt.Fprintf(w, "%s\t%s\t%s\n", e.Type, src, tgt)
	}
	return w.Flush()
}
