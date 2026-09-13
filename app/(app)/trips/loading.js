import PageSkeleton from '@/components/ui/PageSkeleton';

export default function Loading() {
  return <PageSkeleton title="Viagens" subtitle="Partidas agrupadas por autocarro" count={4} itemClassName="h-28" />;
}
