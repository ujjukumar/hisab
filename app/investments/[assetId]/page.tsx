import { PageHead } from '@/components/PageHead/PageHead';
import { Placeholder } from '@/components/Placeholder/Placeholder';

export default async function AssetPage({ params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;

  return (
    <>
      <PageHead title="Holding" />
      <Placeholder title={`Holding ${assetId}`}>
        One holding&rsquo;s figures, its price history and its own transaction list arrive in phase
        3.
      </Placeholder>
    </>
  );
}
