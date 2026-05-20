/**
 * Admin İstemci Sertifikaları (mTLS) — PR-SEC3.
 *
 * İki sekme:
 *   1. Sertifika Yetkilileri (CA): Built-in CA durumu + external CA upload + listele/sil
 *   2. Kullanıcı Sertifikaları: Kullanıcı seçimi → cert listesi, üret, kayıt, revoke
 *
 * Mimari: nginx Ingress mTLS. Ingress `ssl-client-cert` header'ını forward eder;
 * server fingerprint'i `client_certificates` tablosunda doğrular.
 */

import * as React from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import {
  useClientCertCAsQuery,
  useDeleteCACertMutation,
  useIssueClientCertMutation,
  useRegisterClientCertMutation,
  useRevokeClientCertMutation,
  useUploadCACertMutation,
  useUserClientCertsQuery,
} from '@/api/admin-client-certs';
import { useUsers } from '@/api/admin';
import type { ClientCertCA, ClientCertificate, IssueCertResponse } from '@/api/types';
import {
  Download,
  Fingerprint,
  Loader2,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { ApiError } from '@/api/errors';

function describeError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Beklenmeyen bir hata oluştu.';
}

// ---------- CA Tab ----------

function CertificateAuthoritiesTab() {
  const { toast } = useToast();
  const casQuery = useClientCertCAsQuery();
  const uploadCA = useUploadCACertMutation();
  const deleteCA = useDeleteCACertMutation();

  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [caName, setCAName] = React.useState('');
  const [caPem, setCAPem] = React.useState('');
  const [deleteTarget, setDeleteTarget] = React.useState<ClientCertCA | null>(null);

  function resetUploadForm() {
    setCAName('');
    setCAPem('');
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    try {
      await uploadCA.mutateAsync({ name: caName, cert_pem: caPem });
      toast({ title: 'CA yüklendi', description: `"${caName}" başarıyla eklendi.` });
      resetUploadForm();
      setUploadOpen(false);
    } catch (err) {
      toast({ title: 'CA yüklenemedi', description: describeError(err), variant: 'destructive' });
    }
  }

  function handleDeleteConfirm() {
    if (!deleteTarget) return;
    deleteCA.mutate(deleteTarget.id, {
      onSuccess: () => {
        toast({ title: 'CA silindi', description: `"${deleteTarget.name}" kaldırıldı.` });
        setDeleteTarget(null);
      },
      onError: (err) =>
        toast({ title: 'CA silinemedi', description: describeError(err), variant: 'destructive' }),
    });
  }

  const cas = casQuery.data?.cas ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            İstemci sertifikası imzalamak için kullanılan sertifika yetkilileri. Built-in CA
            otomatik oluşturulur; external CA'lar buraya PEM olarak yüklenebilir.
          </p>
        </div>
        <Button size="sm" onClick={() => setUploadOpen(true)}>
          <Plus className="mr-1 h-4 w-4" />
          CA Yükle
        </Button>
      </div>

      {casQuery.isLoading && (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {casQuery.isError && (
        <p className="text-sm text-destructive">CA listesi yüklenemedi.</p>
      )}

      <div className="flex flex-col gap-2">
        {cas.map((ca) => (
          <Card key={ca.id}>
            <CardHeader className="pb-2 pt-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-green-500" />
                  <CardTitle className="text-base">{ca.name}</CardTitle>
                  {ca.is_builtin && (
                    <Badge variant="secondary" className="text-xs">
                      Built-in
                    </Badge>
                  )}
                </div>
                {!ca.is_builtin && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-red-500 hover:text-red-600"
                    onClick={() => setDeleteTarget(ca)}
                    aria-label="CA'yı sil"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="pb-4">
              <p className="text-xs text-muted-foreground font-mono break-all line-clamp-2">
                {ca.cert_pem.split('\n').slice(0, 2).join('\n')}…
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Oluşturuldu: {new Date(ca.created_at).toLocaleDateString('tr-TR')}
              </p>
            </CardContent>
          </Card>
        ))}

        {!casQuery.isLoading && cas.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-6">
            Henüz CA yok. Server built-in CA'yı otomatik oluşturur.
          </p>
        )}
      </div>

      {/* Upload CA Dialog */}
      <Dialog open={uploadOpen} onOpenChange={(o) => !o && setUploadOpen(false)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>External CA Yükle</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleUpload} className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ca-name">CA Adı</Label>
              <Input
                id="ca-name"
                value={caName}
                onChange={(e) => setCAName(e.target.value)}
                placeholder="Örn. Şirket İç CA"
                required
                maxLength={256}
                disabled={uploadCA.isPending}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ca-pem">CA Sertifikası (PEM)</Label>
              <Textarea
                id="ca-pem"
                value={caPem}
                onChange={(e) => setCAPem(e.target.value)}
                placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
                rows={8}
                className="font-mono text-xs"
                required
                disabled={uploadCA.isPending}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setUploadOpen(false)}
                disabled={uploadCA.isPending}
              >
                İptal
              </Button>
              <Button type="submit" disabled={uploadCA.isPending}>
                {uploadCA.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Yükleniyor…
                  </>
                ) : (
                  'CA Yükle'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete CA Confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>CA Silinsin mi?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.name}</strong> CA'sı kaldırılacak. Bu CA'dan üretilmiş aktif
              sertifikalar varsa önce revoke edin.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>İptal</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={deleteCA.isPending}
            >
              {deleteCA.isPending ? 'Siliniyor…' : 'Sil'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------- Issued Cert Dialog (one-time PEM display) ----------

interface IssuedCertDialogProps {
  cert: IssueCertResponse | null;
  onClose: () => void;
}

function IssuedCertDialog({ cert, onClose }: IssuedCertDialogProps) {
  const { toast } = useToast();

  function downloadPem() {
    if (!cert) return;
    const content = `${cert.cert_pem}\n${cert.key_pem}`;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ironstock-cert-${cert.subject_cn.replace(/\s+/g, '-')}.pem`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({ title: 'PEM indirildi', description: 'Özel anahtarı güvenli saklayın.' });
  }

  return (
    <Dialog open={!!cert} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Sertifika Üretildi — Tek Seferlik Gösterim</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-2">
          <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800 flex gap-2">
            <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              Özel anahtar yalnızca şimdi görüntüleniyor. Bu dialog kapandıktan sonra tekrar
              alınamaz. Lütfen PEM dosyasını indirin.
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-mono">CN: {cert?.subject_cn}</Label>
            <Label className="text-xs font-mono text-muted-foreground">
              Parmak izi: {cert?.fingerprint_sha256.slice(0, 16)}…
            </Label>
            <Label className="text-xs text-muted-foreground">
              Geçerlilik: {cert ? new Date(cert.not_before).toLocaleDateString('tr-TR') : '—'} →{' '}
              {cert ? new Date(cert.not_after).toLocaleDateString('tr-TR') : '—'}
            </Label>
          </div>
          <Textarea
            readOnly
            value={cert ? `${cert.cert_pem}\n${cert.key_pem}` : ''}
            rows={10}
            className="font-mono text-xs"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Kapat
          </Button>
          <Button onClick={downloadPem}>
            <Download className="mr-2 h-4 w-4" />
            PEM İndir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- User Certs Tab ----------

function UserCertificatesTab() {
  const { toast } = useToast();
  const casQuery = useClientCertCAsQuery();

  // User picker
  const usersQuery = useUsers({ limit: 200, offset: 0 });
  const [selectedUserId, setSelectedUserId] = React.useState('');

  const userCertsQuery = useUserClientCertsQuery(selectedUserId);
  const issueCert = useIssueClientCertMutation(selectedUserId);
  const registerCert = useRegisterClientCertMutation(selectedUserId);
  const revokeCert = useRevokeClientCertMutation(selectedUserId);

  // Issue cert dialog
  const [issueOpen, setIssueOpen] = React.useState(false);
  const [issueLabel, setIssueLabel] = React.useState('');
  const [issueDays, setIssueDays] = React.useState('');
  const [issuedCert, setIssuedCert] = React.useState<IssueCertResponse | null>(null);

  // Register cert dialog
  const [registerOpen, setRegisterOpen] = React.useState(false);
  const [regPem, setRegPem] = React.useState('');
  const [regCaId, setRegCaId] = React.useState('');
  const [regLabel, setRegLabel] = React.useState('');

  // Revoke confirm
  const [revokeTarget, setRevokeTarget] = React.useState<ClientCertificate | null>(null);

  async function handleIssue(e: React.FormEvent) {
    e.preventDefault();
    const days = issueDays ? parseInt(issueDays, 10) : undefined;
    try {
      const result = await issueCert.mutateAsync({
        label: issueLabel || undefined,
        valid_for_days: days,
      });
      setIssuedCert(result);
      setIssueOpen(false);
      setIssueLabel('');
      setIssueDays('');
    } catch (err) {
      toast({ title: 'Sertifika üretilemedi', description: describeError(err), variant: 'destructive' });
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    try {
      await registerCert.mutateAsync({ cert_pem: regPem, ca_id: regCaId, label: regLabel || undefined });
      toast({ title: 'Sertifika kaydedildi' });
      setRegisterOpen(false);
      setRegPem('');
      setRegCaId('');
      setRegLabel('');
    } catch (err) {
      toast({ title: 'Sertifika kaydedilemedi', description: describeError(err), variant: 'destructive' });
    }
  }

  function handleRevokeConfirm() {
    if (!revokeTarget) return;
    revokeCert.mutate(revokeTarget.id, {
      onSuccess: () => {
        toast({ title: 'Sertifika revoke edildi' });
        setRevokeTarget(null);
      },
      onError: (err) =>
        toast({ title: 'Revoke başarısız', description: describeError(err), variant: 'destructive' }),
    });
  }

  const users = usersQuery.data?.users ?? [];
  const certs = userCertsQuery.data?.certs ?? [];
  const cas = casQuery.data?.cas ?? [];
  const selectedUser = users.find((u) => u.id === selectedUserId);

  return (
    <div className="flex flex-col gap-4">
      {/* User selector */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="cert-user-select">Kullanıcı Seç</Label>
        <Select value={selectedUserId} onValueChange={setSelectedUserId}>
          <SelectTrigger id="cert-user-select" className="w-64">
            <SelectValue placeholder="Kullanıcı seçin…" />
          </SelectTrigger>
          <SelectContent>
            {users.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.username} ({u.email})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!selectedUserId && (
        <p className="text-sm text-muted-foreground">
          Sertifika yönetimi için önce bir kullanıcı seçin.
        </p>
      )}

      {selectedUserId && (
        <>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Fingerprint className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">
                {selectedUser?.username} — {certs.length} sertifika
              </span>
              {selectedUser?.requires_client_cert && (
                <Badge variant="outline" className="border-blue-400 text-blue-700 text-xs">
                  Sertifika Zorunlu
                </Badge>
              )}
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setRegisterOpen(true)}>
                External Kayıt
              </Button>
              <Button size="sm" onClick={() => setIssueOpen(true)}>
                <Plus className="mr-1 h-4 w-4" />
                Sertifika Üret
              </Button>
            </div>
          </div>

          {userCertsQuery.isLoading && (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          <div className="flex flex-col gap-2">
            {certs.map((cert) => {
              const isExpired = new Date(cert.not_after) < new Date();
              const isRevoked = !!cert.revoked_at;
              return (
                <Card key={cert.id} className={isRevoked ? 'opacity-60' : ''}>
                  <CardHeader className="pb-1 pt-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {isRevoked ? (
                          <ShieldAlert className="h-4 w-4 text-red-400" />
                        ) : isExpired ? (
                          <ShieldAlert className="h-4 w-4 text-amber-400" />
                        ) : (
                          <ShieldCheck className="h-4 w-4 text-green-500" />
                        )}
                        <CardTitle className="text-sm">{cert.subject_cn}</CardTitle>
                        {cert.label && (
                          <Badge variant="secondary" className="text-xs">{cert.label}</Badge>
                        )}
                        {isRevoked && (
                          <Badge variant="destructive" className="text-xs">Revoke</Badge>
                        )}
                        {!isRevoked && isExpired && (
                          <Badge variant="outline" className="text-xs border-amber-400 text-amber-700">
                            Süresi Dolmuş
                          </Badge>
                        )}
                      </div>
                      {!isRevoked && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-500 hover:text-red-600 h-7 px-2"
                          onClick={() => setRevokeTarget(cert)}
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-1" />
                          Revoke
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="pb-3">
                    <CardDescription className="font-mono text-xs space-y-0.5">
                      <div>Parmak izi: {cert.fingerprint_sha256.slice(0, 32)}…</div>
                      <div>Seri: {cert.serial_number}</div>
                      <div>
                        Geçerlilik: {new Date(cert.not_before).toLocaleDateString('tr-TR')} →{' '}
                        {new Date(cert.not_after).toLocaleDateString('tr-TR')}
                      </div>
                      <div>CA: {cert.ca_name}</div>
                      {isRevoked && (
                        <div className="text-red-500">
                          Revoke: {new Date(cert.revoked_at!).toLocaleDateString('tr-TR')}
                        </div>
                      )}
                    </CardDescription>
                  </CardContent>
                </Card>
              );
            })}

            {!userCertsQuery.isLoading && certs.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">
                Bu kullanıcı için sertifika yok. "Sertifika Üret" ile yeni bir tane oluşturun.
              </p>
            )}
          </div>
        </>
      )}

      {/* Issue Cert Dialog */}
      <Dialog open={issueOpen} onOpenChange={(o) => !o && setIssueOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Sertifika Üret — {selectedUser?.username}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleIssue} className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="issue-label">Etiket (opsiyonel)</Label>
              <Input
                id="issue-label"
                value={issueLabel}
                onChange={(e) => setIssueLabel(e.target.value)}
                placeholder="Örn. Burak'ın laptop'u"
                maxLength={256}
                disabled={issueCert.isPending}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="issue-days">Geçerlilik (gün, opsiyonel)</Label>
              <Input
                id="issue-days"
                type="number"
                value={issueDays}
                onChange={(e) => setIssueDays(e.target.value)}
                placeholder="730 (varsayılan: 2 yıl)"
                min={1}
                max={3650}
                disabled={issueCert.isPending}
              />
            </div>
            <div className="rounded-md bg-blue-50 border border-blue-200 p-3 text-xs text-blue-800">
              Sertifika built-in CA ile imzalanır. Özel anahtar yalnızca bir kez görüntülenebilir.
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIssueOpen(false)}
                disabled={issueCert.isPending}
              >
                İptal
              </Button>
              <Button type="submit" disabled={issueCert.isPending}>
                {issueCert.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Üretiliyor…
                  </>
                ) : (
                  'Üret'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Register Cert Dialog */}
      <Dialog open={registerOpen} onOpenChange={(o) => !o && setRegisterOpen(false)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>External Sertifika Kaydet — {selectedUser?.username}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleRegister} className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reg-ca">CA Seç</Label>
              <Select value={regCaId} onValueChange={setRegCaId} required>
                <SelectTrigger id="reg-ca">
                  <SelectValue placeholder="CA seçin…" />
                </SelectTrigger>
                <SelectContent>
                  {cas.map((ca) => (
                    <SelectItem key={ca.id} value={ca.id}>
                      {ca.name} {ca.is_builtin ? '(Built-in)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reg-pem">Sertifika (PEM)</Label>
              <Textarea
                id="reg-pem"
                value={regPem}
                onChange={(e) => setRegPem(e.target.value)}
                placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
                rows={6}
                className="font-mono text-xs"
                required
                disabled={registerCert.isPending}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reg-label">Etiket (opsiyonel)</Label>
              <Input
                id="reg-label"
                value={regLabel}
                onChange={(e) => setRegLabel(e.target.value)}
                placeholder="Örn. Güvenlik anahtarı"
                maxLength={256}
                disabled={registerCert.isPending}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRegisterOpen(false)}
                disabled={registerCert.isPending}
              >
                İptal
              </Button>
              <Button type="submit" disabled={registerCert.isPending || !regCaId}>
                {registerCert.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Kaydediliyor…
                  </>
                ) : (
                  'Kaydet'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Revoke Confirm */}
      <AlertDialog open={!!revokeTarget} onOpenChange={(o) => !o && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sertifika Revoke Edilsin mi?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{revokeTarget?.subject_cn}</strong> sertifikası revoke edilecek.
              Bu işlem geri alınamaz; kullanıcı bu sertifikayla artık giriş yapamaz.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>İptal</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRevokeConfirm}
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={revokeCert.isPending}
            >
              {revokeCert.isPending ? 'Revoke ediliyor…' : 'Revoke Et'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* One-time issued cert display */}
      <IssuedCertDialog cert={issuedCert} onClose={() => setIssuedCert(null)} />
    </div>
  );
}

// ---------- Page ----------

export default function AdminClientCertsPage() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">İstemci Sertifikaları (mTLS)</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Kullanıcı kimlik doğrulaması için istemci TLS sertifikalarını yönetin.
          Sertifika zorunluluğu kullanıcı bazında açılabilir.
        </p>
      </div>

      <Tabs defaultValue="cas">
        <TabsList>
          <TabsTrigger value="cas">Sertifika Yetkilileri</TabsTrigger>
          <TabsTrigger value="user-certs">Kullanıcı Sertifikaları</TabsTrigger>
        </TabsList>
        <TabsContent value="cas" className="mt-4">
          <CertificateAuthoritiesTab />
        </TabsContent>
        <TabsContent value="user-certs" className="mt-4">
          <UserCertificatesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
