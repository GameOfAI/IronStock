package k8s

import (
	"context"
	"errors"
	"fmt"
)

// ─── Minimal K8s resource structs ────────────────────────────────────────────
// Only fields needed for the inventory report are included.

// ObjectMeta is common metadata present on all K8s resources.
type ObjectMeta struct {
	Name              string            `json:"name"`
	Namespace         string            `json:"namespace"`
	Labels            map[string]string `json:"labels,omitempty"`
	CreationTimestamp string            `json:"creationTimestamp,omitempty"`
}

// ContainerStatus describes a running container within a pod.
type ContainerStatus struct {
	Name         string `json:"name"`
	Ready        bool   `json:"ready"`
	RestartCount int    `json:"restartCount"`
	Image        string `json:"image"`
}

// PodStatus is the observed state of a Pod.
type PodStatus struct {
	Phase             string            `json:"phase"`
	Conditions        []PodCondition    `json:"conditions,omitempty"`
	ContainerStatuses []ContainerStatus `json:"containerStatuses,omitempty"`
	PodIP             string            `json:"podIP,omitempty"`
	NodeName          string            `json:"nodeName,omitempty"`
}

// PodCondition is one condition in PodStatus.
type PodCondition struct {
	Type   string `json:"type"`
	Status string `json:"status"`
}

// Pod is a K8s Pod resource.
type Pod struct {
	Metadata ObjectMeta `json:"metadata"`
	Status   PodStatus  `json:"status"`
}

// PodList is the list response for Pods.
type PodList struct {
	Items []Pod `json:"items"`
}

// DeploymentCondition is one condition in a Deployment status.
type DeploymentCondition struct {
	Type    string `json:"type"`
	Status  string `json:"status"`
	Reason  string `json:"reason,omitempty"`
	Message string `json:"message,omitempty"`
}

// DeploymentStatus is the observed state of a Deployment.
type DeploymentStatus struct {
	Replicas            int32                 `json:"replicas"`
	ReadyReplicas       int32                 `json:"readyReplicas"`
	AvailableReplicas   int32                 `json:"availableReplicas"`
	UnavailableReplicas int32                 `json:"unavailableReplicas"`
	Conditions          []DeploymentCondition `json:"conditions,omitempty"`
}

// DeploymentSpec holds desired-state fields we care about.
type DeploymentSpec struct {
	Replicas int32 `json:"replicas"`
}

// Deployment is a K8s Deployment resource.
type Deployment struct {
	Metadata ObjectMeta       `json:"metadata"`
	Spec     DeploymentSpec   `json:"spec"`
	Status   DeploymentStatus `json:"status"`
}

// DeploymentList is the list response for Deployments.
type DeploymentList struct {
	Items []Deployment `json:"items"`
}

// ServicePort is a port mapping on a K8s Service.
type ServicePort struct {
	Name     string `json:"name,omitempty"`
	Protocol string `json:"protocol"`
	Port     int32  `json:"port"`
	NodePort int32  `json:"nodePort,omitempty"`
}

// ServiceSpec is the spec of a K8s Service.
type ServiceSpec struct {
	Type      string        `json:"type"`
	ClusterIP string        `json:"clusterIP,omitempty"`
	Ports     []ServicePort `json:"ports,omitempty"`
}

// Service is a K8s Service resource.
type Service struct {
	Metadata ObjectMeta  `json:"metadata"`
	Spec     ServiceSpec `json:"spec"`
}

// ServiceList is the list response for Services.
type ServiceList struct {
	Items []Service `json:"items"`
}

// EventSource is the source of a K8s Event.
type EventSource struct {
	Component string `json:"component,omitempty"`
	Host      string `json:"host,omitempty"`
}

// Event is a K8s Event resource.
type Event struct {
	Metadata       ObjectMeta  `json:"metadata"`
	InvolvedObject ObjectMeta  `json:"involvedObject"`
	Reason         string      `json:"reason"`
	Message        string      `json:"message"`
	Type           string      `json:"type"` // Normal | Warning
	Count          int32       `json:"count"`
	FirstTimestamp string      `json:"firstTimestamp,omitempty"`
	LastTimestamp  string      `json:"lastTimestamp,omitempty"`
	Source         EventSource `json:"source,omitempty"`
}

// EventList is the list response for Events.
type EventList struct {
	Items []Event `json:"items"`
}

// ─── Metrics structs ──────────────────────────────────────────────────────────

// ContainerMetrics holds CPU and memory usage for one container.
type ContainerMetrics struct {
	Name  string            `json:"name"`
	Usage map[string]string `json:"usage"` // "cpu": "125m", "memory": "256Mi"
}

// PodMetrics holds resource usage for one Pod.
type PodMetrics struct {
	Metadata   ObjectMeta         `json:"metadata"`
	Containers []ContainerMetrics `json:"containers"`
}

// PodMetricsList is the list response for PodMetrics (metrics.k8s.io API).
type PodMetricsList struct {
	Items []PodMetrics `json:"items"`
}

// ─── Client methods ───────────────────────────────────────────────────────────

// ListPods returns all pods in the given namespace.
func (c *Client) ListPods(ctx context.Context, namespace string) (*PodList, error) {
	var out PodList
	path := fmt.Sprintf("/api/v1/namespaces/%s/pods", namespace)
	if err := c.doRequest(ctx, path, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ListDeployments returns all deployments in the given namespace.
func (c *Client) ListDeployments(ctx context.Context, namespace string) (*DeploymentList, error) {
	var out DeploymentList
	path := fmt.Sprintf("/apis/apps/v1/namespaces/%s/deployments", namespace)
	if err := c.doRequest(ctx, path, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ListServices returns all services in the given namespace.
func (c *Client) ListServices(ctx context.Context, namespace string) (*ServiceList, error) {
	var out ServiceList
	path := fmt.Sprintf("/api/v1/namespaces/%s/services", namespace)
	if err := c.doRequest(ctx, path, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ListEvents returns all events in the given namespace.
func (c *Client) ListEvents(ctx context.Context, namespace string) (*EventList, error) {
	var out EventList
	path := fmt.Sprintf("/api/v1/namespaces/%s/events", namespace)
	if err := c.doRequest(ctx, path, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ListPodMetrics returns CPU/memory metrics for all pods in the given namespace.
// Returns ErrMetricsUnavailable if the metrics-server is not installed.
func (c *Client) ListPodMetrics(ctx context.Context, namespace string) (*PodMetricsList, error) {
	var out PodMetricsList
	path := fmt.Sprintf("/apis/metrics.k8s.io/v1beta1/namespaces/%s/pods", namespace)
	err := c.doRequest(ctx, path, &out)
	if err != nil {
		// 404 from metrics API typically means metrics-server not installed.
		if errors.Is(err, ErrNotFound) {
			return nil, ErrMetricsUnavailable
		}
		return nil, err
	}
	return &out, nil
}
