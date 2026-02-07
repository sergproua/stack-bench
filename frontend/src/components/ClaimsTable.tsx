import type { CSSProperties } from 'react';
import { FixedSizeList as List } from 'react-window';
import { Claim } from '../api';

type Props = {
  data: Claim[];
  height?: number;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
};

export default function ClaimsTable({ data, height = 520, hasMore, isLoadingMore, onLoadMore }: Props) {
  const Row = ({ index, style }: { index: number; style: CSSProperties }) => {
    const claim = data[index];
    const serviceDate = claim.serviceDate ? new Date(claim.serviceDate).toLocaleDateString() : '—';
    return (
      <div className="row" style={style}>
        <div>{claim.memberName}</div>
        <div>{claim.providerName}</div>
        <div><span className="badge">{claim.status}</span></div>
        <div>{claim.memberRegion}</div>
        <div>{claim.providerSpecialty}</div>
        <div>{serviceDate}</div>
        <div>${claim.totalAmount}</div>
      </div>
    );
  };

  return (
    <div>
      <div className="table-header">
        <div>Member</div>
        <div>Provider</div>
        <div>Status</div>
        <div>Region</div>
        <div>Specialty</div>
        <div>Service Date</div>
        <div>Amount</div>
      </div>
      <List
        height={height}
        itemCount={data.length}
        itemSize={46}
        width="100%"
        onItemsRendered={({ visibleStopIndex }) => {
          if (hasMore && !isLoadingMore && visibleStopIndex >= data.length - 10) {
            onLoadMore();
          }
        }}
      >
        {Row}
      </List>
      {hasMore ? (
        <div style={{ padding: '12px 0', color: '#6b6b6b' }}>
          {isLoadingMore ? 'Loading more...' : 'Scroll to load more'}
        </div>
      ) : (
        <div style={{ padding: '12px 0', color: '#6b6b6b' }}>End of results</div>
      )}
    </div>
  );
}
