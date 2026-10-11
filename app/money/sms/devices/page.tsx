import { SmsDevices, type SmsPhoneItem } from '@/components/SmsDevices/SmsDevices';
import { formatDate } from '@/lib/domain/format';
import { formatReceived, istDate, smsDeviceStatus } from '@/lib/domain/smsReview';
import { pendingSmsDeviceRows, smsDeviceRows } from '@/lib/queries/sms';

export default function SmsDevicesPage() {
  const now = new Date();
  const when = (iso: string) =>
    formatReceived(iso, now).replace(/^(Today|Yesterday)/, (word) => word.toLowerCase());
  const day = (iso: string | null) => {
    const date = iso ? istDate(iso) : null;
    return date ? formatDate(date) : '';
  };

  const requests = pendingSmsDeviceRows().map((device) => ({
    id: device.id,
    label: device.label,
    code: device.code,
    requested: when(device.createdAt),
  }));

  const phones: SmsPhoneItem[] = [];
  const revoked: SmsPhoneItem[] = [];
  for (const device of smsDeviceRows(now)) {
    const status = smsDeviceStatus(device);
    if (status.state === 'revoked') {
      revoked.push({
        id: device.id,
        label: device.label,
        state: status.state,
        status: status.label,
        meta: [`Paired ${day(device.approvedAt)}`, `Revoked ${day(device.revokedAt)}`],
      });
      continue;
    }
    phones.push({
      id: device.id,
      label: device.label,
      state: status.state,
      status: status.label,
      meta: [
        ...(device.lastSeenAt ? [`Last SMS ${when(device.lastSeenAt)}`] : []),
        `${device.receivedThisWeek} SMS this week`,
        `Paired ${day(device.approvedAt)}`,
      ],
    });
  }

  return (
    <>
      <SmsDevices requests={requests} phones={phones} revoked={revoked} />
      <p className="footnote">
        Phones send SMS to Hisaab on this computer. The original text stays encrypted until you
        approve or reject it.
      </p>
    </>
  );
}
