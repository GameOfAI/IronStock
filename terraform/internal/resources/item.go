package resources

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/hashicorp/terraform-plugin-framework/datasource"
	dschema "github.com/hashicorp/terraform-plugin-framework/datasource/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	rschema "github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/types"
)

// --- Resource ---

type itemResource struct {
	client *ironstockClient
}

type itemResourceModel struct {
	ID          types.String `tfsdk:"id"`
	FolderID    types.String `tfsdk:"folder_id"`
	Name        types.String `tfsdk:"name"`
	ItemTypeID  types.Int64  `tfsdk:"item_type_id"`
	Description types.String `tfsdk:"description"`
}

func NewItemResource() resource.Resource {
	return &itemResource{}
}

func (r *itemResource) Metadata(_ context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_item"
}

func (r *itemResource) Schema(_ context.Context, _ resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = rschema.Schema{
		Description: "IronStock item — credential, sertifika veya yapılandırma kaydı.",
		Attributes: map[string]rschema.Attribute{
			"id": rschema.StringAttribute{
				Computed:    true,
				Description: "Item UUID'si",
				PlanModifiers: []planmodifier.String{
					stringplanmodifier.UseStateForUnknown(),
				},
			},
			"folder_id": rschema.StringAttribute{
				Required:    true,
				Description: "Hedef klasör UUID'si",
			},
			"name": rschema.StringAttribute{
				Required:    true,
				Description: "Item adı",
			},
			"item_type_id": rschema.Int64Attribute{
				Optional:    true,
				Description: "Item tipi ID'si (1=Genel, 2=Sunucu, 3=Veritabanı, vb.)",
			},
			"description": rschema.StringAttribute{
				Optional:    true,
				Description: "Item açıklaması",
			},
		},
	}
}

func (r *itemResource) Configure(_ context.Context, req resource.ConfigureRequest, resp *resource.ConfigureResponse) {
	if req.ProviderData == nil {
		return
	}
	r.client = req.ProviderData.(*ironstockClient)
}

func (r *itemResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	var plan itemResourceModel
	diags := req.Plan.Get(ctx, &plan)
	resp.Diagnostics.Append(diags...)
	if resp.Diagnostics.HasError() {
		return
	}

	body := map[string]interface{}{
		"folder_id": plan.FolderID.ValueString(),
		"name":      plan.Name.ValueString(),
	}
	if !plan.ItemTypeID.IsNull() {
		body["item_type_id"] = plan.ItemTypeID.ValueInt64()
	}
	if !plan.Description.IsNull() {
		body["description"] = plan.Description.ValueString()
	}

	jsonBody, _ := json.Marshal(body)
	httpResp, err := r.client.do("POST", "/api/v1/items", jsonBody)
	if err != nil {
		resp.Diagnostics.AddError("Item oluşturulamadı", err.Error())
		return
	}
	defer httpResp.Body.Close()

	if httpResp.StatusCode != http.StatusCreated && httpResp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(httpResp.Body)
		resp.Diagnostics.AddError("API hatası", fmt.Sprintf("status %d: %s", httpResp.StatusCode, string(respBody)))
		return
	}

	var result struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(httpResp.Body).Decode(&result); err != nil {
		resp.Diagnostics.AddError("Yanıt okunamadı", err.Error())
		return
	}

	plan.ID = types.StringValue(result.ID)
	resp.Diagnostics.Append(resp.State.Set(ctx, plan)...)
}

func (r *itemResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	var state itemResourceModel
	diags := req.State.Get(ctx, &state)
	resp.Diagnostics.Append(diags...)
	if resp.Diagnostics.HasError() {
		return
	}

	httpResp, err := r.client.do("GET", fmt.Sprintf("/api/v1/items/%s", state.ID.ValueString()), nil)
	if err != nil {
		resp.Diagnostics.AddError("Item okunamadı", err.Error())
		return
	}
	defer httpResp.Body.Close()

	if httpResp.StatusCode == http.StatusNotFound {
		resp.State.RemoveResource(ctx)
		return
	}

	var result struct {
		ID          string `json:"id"`
		FolderID    string `json:"folder_id"`
		Name        string `json:"name"`
		ItemTypeID  int64  `json:"item_type_id"`
		Description string `json:"description"`
	}
	if err := json.NewDecoder(httpResp.Body).Decode(&result); err != nil {
		resp.Diagnostics.AddError("Yanıt okunamadı", err.Error())
		return
	}

	state.ID = types.StringValue(result.ID)
	state.FolderID = types.StringValue(result.FolderID)
	state.Name = types.StringValue(result.Name)
	if result.ItemTypeID > 0 {
		state.ItemTypeID = types.Int64Value(result.ItemTypeID)
	}
	if result.Description != "" {
		state.Description = types.StringValue(result.Description)
	}
	resp.Diagnostics.Append(resp.State.Set(ctx, state)...)
}

func (r *itemResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	var plan itemResourceModel
	diags := req.Plan.Get(ctx, &plan)
	resp.Diagnostics.Append(diags...)
	if resp.Diagnostics.HasError() {
		return
	}

	body := map[string]interface{}{
		"name": plan.Name.ValueString(),
	}
	if !plan.Description.IsNull() {
		body["description"] = plan.Description.ValueString()
	}

	jsonBody, _ := json.Marshal(body)
	httpResp, err := r.client.do("PUT", fmt.Sprintf("/api/v1/items/%s", plan.ID.ValueString()), jsonBody)
	if err != nil {
		resp.Diagnostics.AddError("Item güncellenemedi", err.Error())
		return
	}
	defer httpResp.Body.Close()

	resp.Diagnostics.Append(resp.State.Set(ctx, plan)...)
}

func (r *itemResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	var state itemResourceModel
	diags := req.State.Get(ctx, &state)
	resp.Diagnostics.Append(diags...)
	if resp.Diagnostics.HasError() {
		return
	}

	httpResp, err := r.client.do("DELETE", fmt.Sprintf("/api/v1/items/%s", state.ID.ValueString()), nil)
	if err != nil {
		resp.Diagnostics.AddError("Item silinemedi", err.Error())
		return
	}
	defer httpResp.Body.Close()
}

// --- Data Source ---

type itemDataSource struct {
	client *ironstockClient
}

type itemDataSourceModel struct {
	ID          types.String `tfsdk:"id"`
	Name        types.String `tfsdk:"name"`
	FolderID    types.String `tfsdk:"folder_id"`
	Description types.String `tfsdk:"description"`
}

func NewItemDataSource() datasource.DataSource {
	return &itemDataSource{}
}

func (d *itemDataSource) Metadata(_ context.Context, req datasource.MetadataRequest, resp *datasource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_item"
}

func (d *itemDataSource) Schema(_ context.Context, _ datasource.SchemaRequest, resp *datasource.SchemaResponse) {
	resp.Schema = dschema.Schema{
		Description: "Mevcut bir IronStock item'ını ID ile okur.",
		Attributes: map[string]dschema.Attribute{
			"id": dschema.StringAttribute{
				Required:    true,
				Description: "Item UUID'si",
			},
			"name": dschema.StringAttribute{
				Computed:    true,
				Description: "Item adı",
			},
			"folder_id": dschema.StringAttribute{
				Computed:    true,
				Description: "Klasör UUID'si",
			},
			"description": dschema.StringAttribute{
				Computed:    true,
				Description: "Item açıklaması",
			},
		},
	}
}

func (d *itemDataSource) Configure(_ context.Context, req datasource.ConfigureRequest, resp *datasource.ConfigureResponse) {
	if req.ProviderData == nil {
		return
	}
	d.client = req.ProviderData.(*ironstockClient)
}

func (d *itemDataSource) Read(ctx context.Context, req datasource.ReadRequest, resp *datasource.ReadResponse) {
	var config itemDataSourceModel
	diags := req.Config.Get(ctx, &config)
	resp.Diagnostics.Append(diags...)
	if resp.Diagnostics.HasError() {
		return
	}

	httpResp, err := d.client.do("GET", fmt.Sprintf("/api/v1/items/%s", config.ID.ValueString()), nil)
	if err != nil {
		resp.Diagnostics.AddError("Item okunamadı", err.Error())
		return
	}
	defer httpResp.Body.Close()

	var result struct {
		ID          string `json:"id"`
		Name        string `json:"name"`
		FolderID    string `json:"folder_id"`
		Description string `json:"description"`
	}
	if err := json.NewDecoder(httpResp.Body).Decode(&result); err != nil {
		resp.Diagnostics.AddError("Yanıt okunamadı", err.Error())
		return
	}

	config.Name = types.StringValue(result.Name)
	config.FolderID = types.StringValue(result.FolderID)
	if result.Description != "" {
		config.Description = types.StringValue(result.Description)
	}
	resp.Diagnostics.Append(resp.State.Set(ctx, config)...)
}
