import PageSkeleton from '@/components/ui/PageSkeleton';

export default function Loading() {
  return <PageSkeleton title="Início" subtitle="A carregar…" count={5} />;
}
