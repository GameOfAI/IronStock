package resources

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClient_Do_SetsHeaders(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer test-token" {
			t.Errorf("Authorization = %q, want Bearer test-token", got)
		}
		if got := r.Header.Get("Content-Type"); got != "application/json" {
			t.Errorf("Content-Type = %q, want application/json", got)
		}
		if got := r.Header.Get("User-Agent"); got != "terraform-provider-ironstock" {
			t.Errorf("User-Agent = %q, want terraform-provider-ironstock", got)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	c := &Client{
		BaseURL:  srv.URL,
		APIToken: "test-token",
		HTTP:     srv.Client(),
	}

	resp, err := c.Do("GET", "/api/v1/folders", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Errorf("status = %d, want 200", resp.StatusCode)
	}
}

func TestClient_Do_SendsBody(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		if string(body) != `{"name":"test"}` {
			t.Errorf("body = %q, want {\"name\":\"test\"}", string(body))
		}
		w.WriteHeader(http.StatusCreated)
	}))
	defer srv.Close()

	c := &Client{
		BaseURL:  srv.URL,
		APIToken: "tok",
		HTTP:     srv.Client(),
	}

	resp, err := c.Do("POST", "/api/v1/folders", []byte(`{"name":"test"}`))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 201 {
		t.Errorf("status = %d, want 201", resp.StatusCode)
	}
}

func TestClient_Do_NilBodyOK(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		if len(body) != 0 {
			t.Errorf("expected empty body, got %q", string(body))
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	c := &Client{
		BaseURL:  srv.URL,
		APIToken: "tok",
		HTTP:     srv.Client(),
	}

	resp, err := c.Do("GET", "/test", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
}
