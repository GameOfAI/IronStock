/**
 * /favorites — User's pinned/favorited items.
 *
 * Uses useFavoritesQuery to list items the current user has starred.
 * Clicking an item navigates to the inventory with that item selected.
 */

import { useNavigate } from 'react-router-dom';
import { Star, ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useFavoritesQuery, useRemoveFavoriteMutation } from '@/api/tags';
import { useToast } from '@/hooks/use-toast';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { tr } from 'date-fns/locale';

export default function FavoritesPage() {
  useDocumentTitle('Favorilerim');
  const navigate = useNavigate();
  const { data, isLoading } = useFavoritesQuery();
  const { toast } = useToast();
  const items = data?.items ?? [];

  function handleOpen(itemId: string, folderId: string) {
    navigate(`/inventory?folder=${folderId}&item=${itemId}`);
  }

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Star className="h-6 w-6 text-amber-400" />
          Favorilerim
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Yıldızladığınız item'lar burada listelenir.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Yükleniyor…
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <Star className="h-10 w-10 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">Henüz favoriye eklediğiniz item yok.</p>
          <Button variant="outline" size="sm" onClick={() => navigate('/inventory')}>
            Envantere Git
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <FavoriteRow
              key={item.id}
              item={item}
              onOpen={() => handleOpen(item.id, item.folder_id)}
              onRemove={() => toast({ title: `"${item.name}" favorilerden kaldırıldı` })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface FavoriteRowProps {
  item: { id: string; folder_id: string; name: string; description?: string; pinned_at: string };
  onOpen: () => void;
  onRemove: () => void;
}

function FavoriteRow({ item, onOpen, onRemove: _onRemove }: FavoriteRowProps) {
  const removeMut = useRemoveFavoriteMutation(item.id);
  const { toast } = useToast();

  function handleRemove(e: React.MouseEvent) {
    e.stopPropagation();
    removeMut.mutate(undefined, {
      onSuccess: () => {
        toast({ title: `"${item.name}" favorilerden kaldırıldı` });
        _onRemove();
      },
    });
  }

  return (
    <div
      className="group flex items-center gap-3 rounded-lg border px-4 py-3 cursor-pointer hover:bg-accent transition"
      onClick={onOpen}
    >
      <Star className="h-4 w-4 shrink-0 text-amber-400" />
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{item.name}</p>
        {item.description && (
          <p className="text-xs text-muted-foreground truncate">{item.description}</p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Badge variant="outline" className="hidden sm:inline-flex text-xs text-muted-foreground">
          {formatDistanceToNow(parseISO(item.pinned_at), { addSuffix: true, locale: tr })}
        </Badge>
        <button
          type="button"
          aria-label="Favorilerden kaldır"
          className="opacity-0 group-hover:opacity-100 rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition"
          onClick={handleRemove}
          disabled={removeMut.isPending}
        >
          {removeMut.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Star className="h-3.5 w-3.5 fill-amber-400" />
          )}
        </button>
        <ArrowRight className="h-4 w-4 text-muted-foreground" />
      </div>
    </div>
  );
}
