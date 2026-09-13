import PageSkeleton from '@/components/ui/PageSkeleton';

export default function Loading() {
  return <PageSkeleton title="Bilhetes" subtitle="Pesquisar e gerir bilhetes" count={5} itemClassName="h-20" />;
}
