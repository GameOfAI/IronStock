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

type folderResource struct {
	client *Client
}

type folderResourceModel struct {
	ID       types.String `tfsdk:"id"`
	Name     types.String `tfsdk:"name"`
	ParentID types.String `tfsdk:"parent_id"`
}

func NewFolderResource() resource.Resource {
	return &folderResource{}
}

func (r *folderResource) Metadata(_ context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_folder"
}

func (r *folderResource) Schema(_ context.Context, _ resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = rschema.Schema{
		Description: "IronStock klasörü — credential'ları organize eder, izin sınırı tanımlar.",
		Attributes: map[string]rschema.Attribute{
			"id": rschema.StringAttribute{
				Computed:    true,
				Description: "Klasör UUID'si",
				PlanModifiers: []planmodifier.String{
					stringplanmodifier.UseStateForUnknown(),
				},
			},
			"name": rschema.StringAttribute{
				Required:    true,
				Description: "Klasör adı",
			},
			"parent_id": rschema.StringAttribute{
				Optional:    true,
				Description: "Üst klasör UUID'si (kök klasör için boş bırakın)",
			},
		},
	}
}

func (r *folderResource) Configure(_ context.Context, req resource.ConfigureRequest, resp *resource.ConfigureResponse) {
	if req.ProviderData == nil {
		return
	}
	r.client = req.ProviderData.(*Client)
}

func (r *folderResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	var plan folderResourceModel
	diags := req.Plan.Get(ctx, &plan)
	resp.Diagnostics.Append(diags...)
	if resp.Diagnostics.HasError() {
		return
	}

	body := map[string]interface{}{
		"name": plan.Name.ValueString(),
	}
	if !plan.ParentID.IsNull() && !plan.ParentID.IsUnknown() {
		body["parent_id"] = plan.ParentID.ValueString()
	}

	jsonBody, _ := json.Marshal(body)
	httpResp, err := r.client.Do("POST", "/api/v1/folders", jsonBody)
	if err != nil {
		resp.Diagnostics.AddError("Klasör oluşturulamadı", err.Error())
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

func (r *folderResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	var state folderResourceModel
	diags := req.State.Get(ctx, &state)
	resp.Diagnostics.Append(diags...)
	if resp.Diagnostics.HasError() {
		return
	}

	httpResp, err := r.client.Do("GET", fmt.Sprintf("/api/v1/folders/%s", state.ID.ValueString()), nil)
	if err != nil {
		resp.Diagnostics.AddError("Klasör okunamadı", err.Error())
		return
	}
	defer httpResp.Body.Close()

	if httpResp.StatusCode == http.StatusNotFound {
		resp.State.RemoveResource(ctx)
		return
	}

	var result struct {
		ID       string `json:"id"`
		Name     string `json:"name"`
		ParentID string `json:"parent_id"`
	}
	if err := json.NewDecoder(httpResp.Body).Decode(&result); err != nil {
		resp.Diagnostics.AddError("Yanıt okunamadı", err.Error())
		return
	}

	state.ID = types.StringValue(result.ID)
	state.Name = types.StringValue(result.Name)
	if result.ParentID != "" {
		state.ParentID = types.StringValue(result.ParentID)
	}
	resp.Diagnostics.Append(resp.State.Set(ctx, state)...)
}

func (r *folderResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	var plan folderResourceModel
	diags := req.Plan.Get(ctx, &plan)
	resp.Diagnostics.Append(diags...)
	if resp.Diagnostics.HasError() {
		return
	}

	body := map[string]interface{}{
		"name": plan.Name.ValueString(),
	}
	jsonBody, _ := json.Marshal(body)
	httpResp, err := r.client.Do("PUT", fmt.Sprintf("/api/v1/folders/%s", plan.ID.ValueString()), jsonBody)
	if err != nil {
		resp.Diagnostics.AddError("Klasör güncellenemedi", err.Error())
		return
	}
	defer httpResp.Body.Close()

	resp.Diagnostics.Append(resp.State.Set(ctx, plan)...)
}

func (r *folderResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	var state folderResourceModel
	diags := req.State.Get(ctx, &state)
	resp.Diagnostics.Append(diags...)
	if resp.Diagnostics.HasError() {
		return
	}

	httpResp, err := r.client.Do("DELETE", fmt.Sprintf("/api/v1/folders/%s", state.ID.ValueString()), nil)
	if err != nil {
		resp.Diagnostics.AddError("Klasör silinemedi", err.Error())
		return
	}
	defer httpResp.Body.Close()
}

// --- Data Source ---

type folderDataSource struct {
	client *Client
}

type folderDataSourceModel struct {
	ID   types.String `tfsdk:"id"`
	Name types.String `tfsdk:"name"`
}

func NewFolderDataSource() datasource.DataSource {
	return &folderDataSource{}
}

func (d *folderDataSource) Metadata(_ context.Context, req datasource.MetadataRequest, resp *datasource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_folder"
}

func (d *folderDataSource) Schema(_ context.Context, _ datasource.SchemaRequest, resp *datasource.SchemaResponse) {
	resp.Schema = dschema.Schema{
		Description: "Mevcut bir IronStock klasörünü ID ile okur.",
		Attributes: map[string]dschema.Attribute{
			"id": dschema.StringAttribute{
				Required:    true,
				Description: "Klasör UUID'si",
			},
			"name": dschema.StringAttribute{
				Computed:    true,
				Description: "Klasör adı",
			},
		},
	}
}

func (d *folderDataSource) Configure(_ context.Context, req datasource.ConfigureRequest, resp *datasource.ConfigureResponse) {
	if req.ProviderData == nil {
		return
	}
	d.client = req.ProviderData.(*Client)
}

func (d *folderDataSource) Read(ctx context.Context, req datasource.ReadRequest, resp *datasource.ReadResponse) {
	var config folderDataSourceModel
	diags := req.Config.Get(ctx, &config)
	resp.Diagnostics.Append(diags...)
	if resp.Diagnostics.HasError() {
		return
	}

	httpResp, err := d.client.Do("GET", fmt.Sprintf("/api/v1/folders/%s", config.ID.ValueString()), nil)
	if err != nil {
		resp.Diagnostics.AddError("Klasör okunamadı", err.Error())
		return
	}
	defer httpResp.Body.Close()

	var result struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	if err := json.NewDecoder(httpResp.Body).Decode(&result); err != nil {
		resp.Diagnostics.AddError("Yanıt okunamadı", err.Error())
		return
	}

	config.Name = types.StringValue(result.Name)
	resp.Diagnostics.Append(resp.State.Set(ctx, config)...)
}
