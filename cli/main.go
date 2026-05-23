// ironstock is the command-line interface for IronStock, the self-hosted
// credential and infrastructure inventory vault.
//
// Build:
//   go build -ldflags "-X ironstock.app/cli/cmd.Version=1.0.0" -o ironstock .
//
// Cross-compile:
//   GOOS=linux   GOARCH=amd64  go build -o ironstock-linux-amd64 .
//   GOOS=darwin  GOARCH=arm64  go build -o ironstock-darwin-arm64 .
//   GOOS=windows GOARCH=amd64  go build -o ironstock-windows-amd64.exe .
package main

import "ironstock.app/cli/cmd"

func main() {
	cmd.Execute()
}
