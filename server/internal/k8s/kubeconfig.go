package k8s

import (
	"encoding/base64"
	"errors"
	"fmt"

	"gopkg.in/yaml.v3"
)

// KubeconfigAuth holds the resolved credentials from a kubeconfig YAML.
// Only inline (base64-encoded data) credentials are supported.
type KubeconfigAuth struct {
	ServerURL  string
	CACertPEM  string
	ClientCert string // PEM
	ClientKey  string // PEM
	Token      string
}

// kubeconfigFile mirrors the top-level structure of a kubeconfig YAML.
type kubeconfigFile struct {
	CurrentContext string              `yaml:"current-context"`
	Clusters       []kubeconfigCluster `yaml:"clusters"`
	Users          []kubeconfigUser    `yaml:"users"`
	Contexts       []kubeconfigContext `yaml:"contexts"`
}

type kubeconfigCluster struct {
	Name    string                  `yaml:"name"`
	Cluster kubeconfigClusterInline `yaml:"cluster"`
}

type kubeconfigClusterInline struct {
	Server                   string `yaml:"server"`
	CertificateAuthorityData string `yaml:"certificate-authority-data"`
	CertificateAuthority     string `yaml:"certificate-authority"` // file path — rejected
	InsecureSkipTLSVerify    bool   `yaml:"insecure-skip-tls-verify"`
}

type kubeconfigUser struct {
	Name string               `yaml:"name"`
	User kubeconfigUserInline `yaml:"user"`
}

type kubeconfigUserInline struct {
	ClientCertificateData string `yaml:"client-certificate-data"`
	ClientKeyData         string `yaml:"client-key-data"`
	ClientCertificate     string `yaml:"client-certificate"` // file path — rejected
	ClientKey             string `yaml:"client-key"`         // file path — rejected
	Token                 string `yaml:"token"`
	TokenFile             string `yaml:"tokenFile"` // file path — rejected
	Exec                  any    `yaml:"exec"`      // exec auth — rejected
}

type kubeconfigContext struct {
	Name    string                  `yaml:"name"`
	Context kubeconfigContextInline `yaml:"context"`
}

type kubeconfigContextInline struct {
	Cluster string `yaml:"cluster"`
	User    string `yaml:"user"`
}

// ParseKubeconfig parses a kubeconfig YAML and extracts credentials for the
// current-context. Only inline base64-encoded data credentials are accepted;
// file paths and exec-based auth are rejected.
func ParseKubeconfig(data []byte) (*KubeconfigAuth, error) {
	var kc kubeconfigFile
	if err := yaml.Unmarshal(data, &kc); err != nil {
		return nil, fmt.Errorf("k8s: parse kubeconfig: %w", err)
	}

	if kc.CurrentContext == "" {
		return nil, errors.New("k8s: kubeconfig has no current-context")
	}

	// Resolve context.
	var ctxCluster, ctxUser string
	for _, c := range kc.Contexts {
		if c.Name == kc.CurrentContext {
			ctxCluster = c.Context.Cluster
			ctxUser = c.Context.User
			break
		}
	}
	if ctxCluster == "" {
		return nil, fmt.Errorf("k8s: context %q not found in kubeconfig", kc.CurrentContext)
	}

	// Resolve cluster.
	var cluster *kubeconfigClusterInline
	for i := range kc.Clusters {
		if kc.Clusters[i].Name == ctxCluster {
			cluster = &kc.Clusters[i].Cluster
			break
		}
	}
	if cluster == nil {
		return nil, fmt.Errorf("k8s: cluster %q not found in kubeconfig", ctxCluster)
	}

	// Reject file-path CA.
	if cluster.CertificateAuthority != "" {
		return nil, errors.New("k8s: file-path certificate-authority not supported — use certificate-authority-data (base64)")
	}

	// Resolve user.
	var user *kubeconfigUserInline
	for i := range kc.Users {
		if kc.Users[i].Name == ctxUser {
			user = &kc.Users[i].User
			break
		}
	}
	if user == nil {
		return nil, fmt.Errorf("k8s: user %q not found in kubeconfig", ctxUser)
	}

	// Reject exec auth.
	if user.Exec != nil {
		return nil, errors.New("k8s: exec-based auth not supported — use ServiceAccount token or client certificate")
	}
	// Reject file paths.
	if user.ClientCertificate != "" || user.ClientKey != "" {
		return nil, errors.New("k8s: file-path client-certificate/client-key not supported — use client-certificate-data/client-key-data (base64)")
	}
	if user.TokenFile != "" {
		return nil, errors.New("k8s: tokenFile not supported — use inline token")
	}

	auth := &KubeconfigAuth{
		ServerURL: cluster.Server,
		Token:     user.Token,
	}

	// Decode CA cert.
	if cluster.CertificateAuthorityData != "" {
		caPEM, err := base64.StdEncoding.DecodeString(cluster.CertificateAuthorityData)
		if err != nil {
			return nil, fmt.Errorf("k8s: decode certificate-authority-data: %w", err)
		}
		auth.CACertPEM = string(caPEM)
	}

	// Decode client cert.
	if user.ClientCertificateData != "" {
		certPEM, err := base64.StdEncoding.DecodeString(user.ClientCertificateData)
		if err != nil {
			return nil, fmt.Errorf("k8s: decode client-certificate-data: %w", err)
		}
		auth.ClientCert = string(certPEM)
	}

	// Decode client key.
	if user.ClientKeyData != "" {
		keyPEM, err := base64.StdEncoding.DecodeString(user.ClientKeyData)
		if err != nil {
			return nil, fmt.Errorf("k8s: decode client-key-data: %w", err)
		}
		auth.ClientKey = string(keyPEM)
	}

	return auth, nil
}
