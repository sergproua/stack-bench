import type { CSSProperties } from 'react';
import { FixedSizeList as List } from 'react-window';
import { Claim } from '../api';

type Props = {
  data: Claim[];
  height?: number;
};

export default function ClaimsTable({ data, height = 520 }: Props) {
  const Row = ({ index, style }: { index: number; style: CSSProperties }) => {
    const claim = data[index];
    return (
      <div className="row" style={style}>
        <div>{claim.memberName}</div>
        <div>{claim.providerName}</div>
        <div><span className="badge">{claim.status}</span></div>
        <div>{claim.memberRegion}</div>
        <div>{claim.providerSpecialty}</div>
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
        <div>Amount</div>
      </div>
      <List height={height} itemCount={data.length} itemSize={46} width="100%">
        {Row}
      </List>
    </div>
  );
}
