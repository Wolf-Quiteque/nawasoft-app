import PageSkeleton from '@/components/ui/PageSkeleton';

export default function Loading() {
  return <PageSkeleton title="Rotas" subtitle="Rotas agrupadas por província" count={4} itemClassName="h-16" />;
}
