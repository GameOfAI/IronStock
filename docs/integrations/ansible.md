# Ansible Entegrasyonu

IronStock, Ansible dynamic inventory kaynağı olarak kullanılabilir. Credential'lar doğrudan playbook'lara aktarılır.

## API Token Oluşturma

1. Web arayüzünden `/settings/api-tokens` sayfasına gidin
2. "Yeni Token" → scope: `ansible` seçin
3. Token'ı güvenli bir yere kaydedin (bir kez gösterilir)

## Dynamic Inventory Kullanımı

```bash
# Envanter listesi
curl -H "Authorization: Bearer <API_TOKEN>" \
  http://localhost:8080/api/v1/ansible/inventory

# Ansible ile doğrudan kullanım
ansible-inventory -i ironstock_inventory.py --list
```

### Inventory Script

```python
#!/usr/bin/env python3
import json, os, urllib.request

url = os.environ.get("IRONSTOCK_URL", "http://localhost:8080")
token = os.environ["IRONSTOCK_API_TOKEN"]

req = urllib.request.Request(
    f"{url}/api/v1/ansible/inventory",
    headers={"Authorization": f"Bearer {token}"}
)
with urllib.request.urlopen(req) as resp:
    print(resp.read().decode())
```

```bash
chmod +x ironstock_inventory.py
export IRONSTOCK_URL=http://localhost:8080
export IRONSTOCK_API_TOKEN=ist_...
ansible-playbook -i ironstock_inventory.py site.yml
```

## Inventory Formatı

IronStock, Ansible'ın beklediği JSON formatında envanter döndürür:

```json
{
  "_meta": {
    "hostvars": {
      "mysql-prod": {
        "ansible_host": "10.0.1.5",
        "ansible_user": "deploy",
        "ironstock_item_id": "uuid-..."
      }
    }
  },
  "database": {
    "hosts": ["mysql-prod", "postgres-prod"]
  }
}
```

Gruplar IronStock klasör yapısından türetilir. Field değerleri `hostvars` olarak aktarılır.
