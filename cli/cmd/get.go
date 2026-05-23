package cmd

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/atotto/clipboard"
	"github.com/spf13/cobra"

	"ironstock.app/cli/internal/client"
)

var getCmd = &cobra.Command{
	Use:   "get <item-name>",
	Short: "Retrieve an item from the vault",
	Long: `Retrieve an item by name. With --field, print only that field's value.

Examples:
  ironstock get prod-db
  ironstock get prod-db --field password
  ironstock get prod-db --field password --clip`,
	Args: cobra.ExactArgs(1),
	RunE: runGet,
}

var getFlags struct {
	Field     string
	Clip      bool
	ClipClear int // seconds before clipboard is cleared (0 = no auto-clear)
}

func init() {
	getCmd.Flags().StringVarP(&getFlags.Field, "field", "f", "",
		"Field key to retrieve (e.g. password, hostname)")
	getCmd.Flags().BoolVarP(&getFlags.Clip, "clip", "c", false,
		"Copy field value to clipboard instead of printing")
	getCmd.Flags().IntVar(&getFlags.ClipClear, "clip-clear", 30,
		"Seconds before clipboard is auto-cleared (0 to disable)")
}

// item represents a minimal item returned by the search endpoint.
type item struct {
	ID          string      `json:"id"`
	Name        string      `json:"name_plain"`
	Description string      `json:"description"`
	ItemType    string      `json:"item_type"`
	FolderID    string      `json:"folder_id"`
	ExpiresAt   *string     `json:"expires_at"`
	CreatedAt   string      `json:"created_at"`
	Fields      []itemField `json:"fields"`
}

type itemField struct {
	FieldDefKey string  `json:"field_def_key"`
	Label       string  `json:"label"`
	IsSecret    bool    `json:"is_secret"`
	ValueEnc    *string `json:"value_enc"` // base64-encoded ciphertext (E2E)
	ValuePlain  *string `json:"value_plain"` // only for non-secret fields
}

func runGet(cmd *cobra.Command, args []string) error {
	ctx := context.Background()
	name := args[0]

	c, err := client.New()
	if err != nil {
		return err
	}

	// Search by name (exact + substring).
	q := url.Values{"q": {name}, "limit": {"20"}}
	resp, err := c.Do(ctx, http.MethodGet, "/api/v1/items/search?"+q.Encode(), nil)
	if err != nil {
		return fmt.Errorf("get: search: %w", err)
	}

	var searchResult struct {
		Items []item `json:"items"`
	}
	if err := client.JSON(resp, &searchResult); err != nil {
		return fmt.Errorf("get: %w", err)
	}

	if len(searchResult.Items) == 0 {
		return fmt.Errorf("get: no item found matching %q", name)
	}

	// Pick exact match first, then first fuzzy match.
	var found *item
	for i := range searchResult.Items {
		if strings.EqualFold(searchResult.Items[i].Name, name) {
			found = &searchResult.Items[i]
			break
		}
	}
	if found == nil {
		found = &searchResult.Items[0]
	}

	// Fetch full item (with fields).
	itemResp, err := c.Do(ctx, http.MethodGet, "/api/v1/items/"+found.ID, nil)
	if err != nil {
		return fmt.Errorf("get: fetch item: %w", err)
	}
	var fullItem item
	if err := client.JSON(itemResp, &fullItem); err != nil {
		return fmt.Errorf("get: %w", err)
	}

	// --field mode.
	if getFlags.Field != "" {
		val := findFieldValue(&fullItem, getFlags.Field)
		if val == "" {
			return fmt.Errorf("get: field %q not found or is E2E encrypted (decrypt in desktop client)", getFlags.Field)
		}
		if getFlags.Clip {
			return copyToClip(val, getFlags.ClipClear)
		}
		fmt.Print(val)
		if !strings.HasSuffix(val, "\n") {
			fmt.Println()
		}
		return nil
	}

	// Full item output.
	if globalFlags.JSONOutput {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(fullItem)
	}

	printItem(&fullItem)
	return nil
}

// findFieldValue returns the plaintext value for a non-secret field.
// Secret fields (E2E encrypted) return "" — the server cannot decrypt them.
func findFieldValue(it *item, key string) string {
	for _, f := range it.Fields {
		if strings.EqualFold(f.FieldDefKey, key) || strings.EqualFold(f.Label, key) {
			if f.ValuePlain != nil {
				return *f.ValuePlain
			}
			// Secret field: E2E encrypted, cannot be read here.
			return ""
		}
	}
	return ""
}

func printItem(it *item) {
	fmt.Printf("Name:     %s\n", it.Name)
	fmt.Printf("Type:     %s\n", it.ItemType)
	if it.Description != "" {
		fmt.Printf("Desc:     %s\n", it.Description)
	}
	if it.ExpiresAt != nil {
		fmt.Printf("Expires:  %s\n", *it.ExpiresAt)
	}
	if len(it.Fields) > 0 {
		fmt.Println("Fields:")
		for _, f := range it.Fields {
			if f.IsSecret {
				fmt.Printf("  %-24s [encrypted — use desktop client]\n", f.Label)
			} else if f.ValuePlain != nil {
				fmt.Printf("  %-24s %s\n", f.Label, *f.ValuePlain)
			}
		}
	}
}

func copyToClip(val string, clearSec int) error {
	if err := clipboard.WriteAll(val); err != nil {
		return fmt.Errorf("clipboard: %w", err)
	}
	if !globalFlags.Quiet {
		if clearSec > 0 {
			fmt.Fprintf(os.Stderr, "Copied to clipboard. Clearing in %ds…\n", clearSec)
		} else {
			fmt.Fprintln(os.Stderr, "Copied to clipboard.")
		}
	}
	if clearSec > 0 {
		go func() {
			time.Sleep(time.Duration(clearSec) * time.Second)
			_ = clipboard.WriteAll("")
		}()
	}
	return nil
}
