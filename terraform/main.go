// Terraform Provider for IronStock — credential vault IaC yönetimi.
//
// Kullanım:
//
//	terraform {
//	  required_providers {
//	    ironstock = {
//	      source = "gameofai/ironstock"
//	    }
//	  }
//	}
//
//	provider "ironstock" {
//	  url       = "https://ironstock.example.com"
//	  api_token = var.ironstock_token
//	}
package main

import (
	"context"
	"flag"
	"log"

	"github.com/hashicorp/terraform-plugin-framework/providerserver"
	"ironstock.app/terraform-provider-ironstock/internal/provider"
)

var version = "dev"

func main() {
	var debug bool
	flag.BoolVar(&debug, "debug", false, "set to true to run the provider with support for debuggers")
	flag.Parse()

	opts := providerserver.ServeOpts{
		Address: "registry.terraform.io/gameofai/ironstock",
		Debug:   debug,
	}

	if err := providerserver.Serve(context.Background(), provider.New(version), opts); err != nil {
		log.Fatal(err.Error())
	}
}
