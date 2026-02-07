import type { SlowOp } from '../api';

const formatDate = (value?: string) => {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
};

type Props = {
  data: SlowOp[];
  onSelect: (op: SlowOp) => void;
};

export default function SlowOpsTable({ data, onSelect }: Props) {
  return (
    <div>
      <div className="slow-table-header">
        <div>Time</div>
        <div>Duration</div>
        <div>Op</div>
        <div>Namespace</div>
        <div>Plan</div>
        <div>Docs</div>
        <div>Keys</div>
      </div>
      {data.map((op, index) => (
        <div className="slow-row" key={`${op.ts ?? 'ts'}-${index}`} onClick={() => onSelect(op)}>
          <div>{formatDate(op.ts)}</div>
          <div>{op.millis ?? '—'} ms</div>
          <div>{op.op ?? '—'}</div>
          <div>{op.ns ?? '—'}</div>
          <div>{op.planSummary ?? '—'}</div>
          <div>{op.docsExamined ?? '—'}</div>
          <div>{op.keysExamined ?? '—'}</div>
        </div>
      ))}
    </div>
  );
}
