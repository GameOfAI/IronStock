import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export default function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 bg-muted/20">
      <p className="text-4xl font-bold text-muted-foreground">404</p>
      <p className="text-sm text-muted-foreground">Sayfa bulunamadı.</p>
      <Button variant="outline" onClick={() => navigate(-1)}>
        Geri dön
      </Button>
    </div>
  );
}
