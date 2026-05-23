package cmd

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/spf13/cobra"

	"ironstock.app/cli/internal/client"
)

var createCmd = &cobra.Command{
	Use:   "create",
	Short: "Create resources in the vault",
}

var createItemCmd = &cobra.Command{
	Use:   "item",
	Short: "Create a new item",
	Long: `Create a new item in the vault.

Examples:
  ironstock create item --name "Redis Cache" --type server --folder <folder-id>
  ironstock create item --name "AWS Key" --type api_key --description "Production access key"`,
	RunE: runCreateItem,
}

var createItemFlags struct {
	Name        string
	ItemType    string
	FolderID    string
	Description string
}

func init() {
	createCmd.AddCommand(createItemCmd)
	createItemCmd.Flags().StringVarP(&createItemFlags.Name, "name", "n", "", "Item name (required)")
	createItemCmd.Flags().StringVarP(&createItemFlags.ItemType, "type", "t", "", "Item type key (e.g. server, database, api_key)")
	createItemCmd.Flags().StringVar(&createItemFlags.FolderID, "folder", "", "Folder UUID (required)")
	createItemCmd.Flags().StringVarP(&createItemFlags.Description, "description", "d", "", "Item description")
	_ = createItemCmd.MarkFlagRequired("name")
	_ = createItemCmd.MarkFlagRequired("folder")
}

func runCreateItem(cmd *cobra.Command, _ []string) error {
	ctx := context.Background()

	c, err := client.New()
	if err != nil {
		return err
	}

	// Look up item type ID if a key was given.
	itemTypeID := createItemFlags.ItemType
	if itemTypeID != "" && !isUUID(itemTypeID) {
		itemTypeID, err = resolveItemTypeID(ctx, c, createItemFlags.ItemType)
		if err != nil {
			return err
		}
	}

	payload := map[string]any{
		"name_plain":  createItemFlags.Name,
		"folder_id":   createItemFlags.FolderID,
		"description": createItemFlags.Description,
	}
	if itemTypeID != "" {
		payload["item_type_id"] = itemTypeID
	}

	resp, err := c.Do(ctx, http.MethodPost, "/api/v1/items/", payload)
	if err != nil {
		return fmt.Errorf("create item: %w", err)
	}

	var created item
	if err := client.JSON(resp, &created); err != nil {
		return fmt.Errorf("create item: %w", err)
	}

	if globalFlags.JSONOutput {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(created)
	}

	if !globalFlags.Quiet {
		fmt.Printf("Created item %q (id: %s)\n", created.Name, created.ID)
	} else {
		fmt.Println(created.ID)
	}
	return nil
}

func resolveItemTypeID(ctx context.Context, c *client.Client, key string) (string, error) {
	resp, err := c.Do(ctx, http.MethodGet, "/api/v1/item-types", nil)
	if err != nil {
		return "", fmt.Errorf("resolve item type: %w", err)
	}
	var result struct {
		ItemTypes []struct {
			ID  string `json:"id"`
			Key string `json:"key"`
		} `json:"item_types"`
	}
	if err := client.JSON(resp, &result); err != nil {
		return "", fmt.Errorf("resolve item type: %w", err)
	}
	for _, t := range result.ItemTypes {
		if strings.EqualFold(t.Key, key) {
			return t.ID, nil
		}
	}
	return "", fmt.Errorf("resolve item type: unknown type %q", key)
}

func isUUID(s string) bool {
	if len(s) != 36 {
		return false
	}
	// Rough check: 8-4-4-4-12 pattern.
	parts := strings.Split(s, "-")
	return len(parts) == 5
}
