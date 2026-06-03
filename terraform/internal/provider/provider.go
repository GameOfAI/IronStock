package provider

import (
	"context"
	"net/http"
	"time"

	"github.com/hashicorp/terraform-plugin-framework/datasource"
	"github.com/hashicorp/terraform-plugin-framework/provider"
	"github.com/hashicorp/terraform-plugin-framework/provider/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/types"

	"ironstock.app/terraform-provider-ironstock/internal/resources"
)

type ironstockProvider struct {
	version string
}

type ironstockProviderModel struct {
	URL      types.String `tfsdk:"url"`
	APIToken types.String `tfsdk:"api_token"`
}

func New(version string) func() provider.Provider {
	return func() provider.Provider {
		return &ironstockProvider{version: version}
	}
}

func (p *ironstockProvider) Metadata(_ context.Context, _ provider.MetadataRequest, resp *provider.MetadataResponse) {
	resp.TypeName = "ironstock"
	resp.Version = p.version
}

func (p *ironstockProvider) Schema(_ context.Context, _ provider.SchemaRequest, resp *provider.SchemaResponse) {
	resp.Schema = schema.Schema{
		Description: "IronStock credential vault Terraform provider. Klasör, item ve paylaşım yönetimi için IaC desteği.",
		Attributes: map[string]schema.Attribute{
			"url": schema.StringAttribute{
				Description: "IronStock API URL'si (ör. https://ironstock.example.com)",
				Required:    true,
			},
			"api_token": schema.StringAttribute{
				Description: "IronStock API token'ı (scope: terraform)",
				Required:    true,
				Sensitive:   true,
			},
		},
	}
}

func (p *ironstockProvider) Configure(ctx context.Context, req provider.ConfigureRequest, resp *provider.ConfigureResponse) {
	var config ironstockProviderModel
	diags := req.Config.Get(ctx, &config)
	resp.Diagnostics.Append(diags...)
	if resp.Diagnostics.HasError() {
		return
	}

	if config.URL.IsUnknown() || config.URL.IsNull() {
		resp.Diagnostics.AddError("URL gerekli", "IronStock API URL'si belirtilmelidir")
		return
	}
	if config.APIToken.IsUnknown() || config.APIToken.IsNull() {
		resp.Diagnostics.AddError("API Token gerekli", "IronStock API token'ı belirtilmelidir")
		return
	}

	client := &resources.Client{
		BaseURL:  config.URL.ValueString(),
		APIToken: config.APIToken.ValueString(),
		HTTP: &http.Client{
			Timeout: 30 * time.Second,
		},
	}

	resp.DataSourceData = client
	resp.ResourceData = client
}

func (p *ironstockProvider) Resources(_ context.Context) []func() resource.Resource {
	return []func() resource.Resource{
		resources.NewFolderResource,
		resources.NewItemResource,
		resources.NewGroupResource,
	}
}

func (p *ironstockProvider) DataSources(_ context.Context) []func() datasource.DataSource {
	return []func() datasource.DataSource{
		resources.NewFolderDataSource,
		resources.NewItemDataSource,
	}
}
