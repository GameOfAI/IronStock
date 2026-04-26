import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Sayfa Bulunamadı</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">Aradığınız sayfa mevcut değil.</p>
          <Link to="/inventory" className="text-sm text-primary underline-offset-4 hover:underline">
            Envantere dön
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
