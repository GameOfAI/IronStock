# Documentation

Complete documentation for deploying, operating, and extending IronStock.

---

## Quick Links

| I want to... | Go to |
|--------------|-------|
| Deploy to Kubernetes | [ops/deployment.md](ops/deployment.md) |
| Set up backups | [ops/backup.md](ops/backup.md) |
| Recover from disaster | [ops/disaster-recovery.md](ops/disaster-recovery.md) |
| Configure monitoring | [ops/monitoring.md](ops/monitoring.md) |
| Understand the security model | [security/threat-model.md](security/threat-model.md) |
| Set up SSO / SCIM | [integrations/scim.md](integrations/scim.md) |
| Use the CLI | [integrations/cli.md](integrations/cli.md) |
| Use the Terraform provider | [integrations/terraform.md](integrations/terraform.md) |
| Understand the auth flow | [auth-flow.md](auth-flow.md) |

---

## Documentation Map

### Architecture Decision Records

Rationale behind key technical choices.

| ADR | Title |
|-----|-------|
| [0001](adr/0001-tech-stack.md) | Tech Stack Selection |
| [0002](adr/0002-security-model.md) | Hybrid Encryption Model |
| [0003](adr/0003-repo-layout.md) | Monorepo Structure |
| [0004](adr/0004-encryption-details.md) | Encryption Implementation Details |
| [0005](adr/0005-migration-tool.md) | Migration Tool Selection |
| [0006](adr/0006-data-model-extensions.md) | Data Model Extensions |
| [0007](adr/0007-external-secret-backends.md) | External Secret Backends |
| [0008](adr/0008-deployment-stack.md) | Deployment Stack |
| [0009](adr/0009-web-state-management.md) | Web State Management |
| [0010](adr/0010-bootstrap-admin-panel.md) | Bootstrap Admin Panel |
| [0011](adr/0011-item-search-model.md) | Item Search Model |
| [0012](adr/0012-development-tracking-discipline.md) | Development Tracking Discipline |

### Operations

Guides for running IronStock in production.

| Guide | Description |
|-------|-------------|
| [deployment.md](ops/deployment.md) | Kubernetes deployment walkthrough |
| [backup.md](ops/backup.md) | Backup configuration and procedures |
| [restore.md](ops/restore.md) | Restore from backup |
| [disaster-recovery.md](ops/disaster-recovery.md) | DR procedures and runbook |
| [monitoring.md](ops/monitoring.md) | Prometheus + Grafana setup |
| [slo.md](ops/slo.md) | Service Level Objectives and targets |
| [sealed-secrets.md](ops/sealed-secrets.md) | Sealed Secrets for GitOps |

### Security

| Document | Description |
|----------|-------------|
| [threat-model.md](security/threat-model.md) | Threat model and mitigations |

### Integrations

Guides for connecting IronStock with external tools.

| Guide | Description |
|-------|-------------|
| [cli.md](integrations/cli.md) | `ironstock` CLI usage |
| [terraform.md](integrations/terraform.md) | Terraform provider |
| [ansible.md](integrations/ansible.md) | Ansible dynamic inventory |
| [vault.md](integrations/vault.md) | HashiCorp Vault integration |
| [scim.md](integrations/scim.md) | SCIM 2.0 provisioning (Azure AD, Okta) |
| [browser-extension.md](integrations/browser-extension.md) | Browser extension setup |

### API

| Document | Description |
|----------|-------------|
| [api/README.md](api/README.md) | API documentation index |
| [auth-flow.md](auth-flow.md) | Authentication flow details |

### Admin Guide

| Document | Description |
|----------|-------------|
| [admin-guide/README.md](admin-guide/README.md) | Administrator guide |

### Other

| Document | Description |
|----------|-------------|
| [smoke-test.md](smoke-test.md) | Smoke test procedures |
| [plan-bootstrap-admin.md](plan-bootstrap-admin.md) | Bootstrap admin setup plan |
| [diagrams/README.md](diagrams/README.md) | Architecture diagrams |
