package cmd

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/spf13/cobra"

	"ironstock.app/cli/internal/client"
)

var updateCmd = &cobra.Command{
	Use:   "update",
	Short: "Update resources in the vault",
}

var updateItemCmd = &cobra.Command{
	Use:   "item <item-id>",
	Short: "Update an item's metadata (non-secret fields)",
	Long: `Update an item's metadata.

Non-secret fields can be updated directly. Secret fields (passwords, keys)
must be updated through the desktop client to preserve E2E encryption.

Examples:
  ironstock update item <id> --field hostname=10.0.0.5
  ironstock update item <id> --description "Updated production database"`,
	Args: cobra.ExactArgs(1),
	RunE: runUpdateItem,
}

var updateItemFlags struct {
	Fields      []string
	Description string
	Name        string
}

func init() {
	updateCmd.AddCommand(updateItemCmd)
	updateItemCmd.Flags().StringArrayVarP(&updateItemFlags.Fields, "field", "f", nil,
		"Field to update in key=value format (repeatable). Non-secret fields only.")
	updateItemCmd.Flags().StringVarP(&updateItemFlags.Description, "description", "d", "",
		"New description")
	updateItemCmd.Flags().StringVarP(&updateItemFlags.Name, "name", "n", "",
		"New name")
}

func runUpdateItem(cmd *cobra.Command, args []string) error {
	ctx := context.Background()
	itemID := args[0]

	c, err := client.New()
	if err != nil {
		return err
	}

	payload := map[string]any{}
	if updateItemFlags.Name != "" {
		payload["name_plain"] = updateItemFlags.Name
	}
	if updateItemFlags.Description != "" {
		payload["description"] = updateItemFlags.Description
	}

	// Parse field=value pairs.
	if len(updateItemFlags.Fields) > 0 {
		fields := make([]map[string]string, 0, len(updateItemFlags.Fields))
		for _, kv := range updateItemFlags.Fields {
			parts := strings.SplitN(kv, "=", 2)
			if len(parts) != 2 {
				return fmt.Errorf("update: invalid field format %q (expected key=value)", kv)
			}
			fields = append(fields, map[string]string{
				"field_def_key": parts[0],
				"value_plain":   parts[1],
			})
		}
		payload["fields"] = fields
	}

	if len(payload) == 0 {
		return fmt.Errorf("update: nothing to update (provide --name, --description, or --field)")
	}

	resp, err := c.Do(ctx, http.MethodPut, "/api/v1/items/"+itemID, payload)
	if err != nil {
		return fmt.Errorf("update item: %w", err)
	}

	var updated item
	if err := client.JSON(resp, &updated); err != nil {
		return fmt.Errorf("update item: %w", err)
	}

	if !globalFlags.Quiet {
		fmt.Printf("Updated item %q\n", updated.Name)
	}
	return nil
}
