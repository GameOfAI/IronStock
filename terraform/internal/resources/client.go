package resources

import (
	"io"
	"net/http"
	"strings"
)

type Client struct {
	BaseURL  string
	APIToken string
	HTTP     *http.Client
}

func (c *Client) Do(method, path string, body []byte) (*http.Response, error) {
	url := c.BaseURL + path
	var r io.Reader
	if body != nil {
		r = strings.NewReader(string(body))
	}
	req, err := http.NewRequest(method, url, r)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.APIToken)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "terraform-provider-ironstock")
	return c.HTTP.Do(req)
}
