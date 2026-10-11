import type { ReactNode } from 'react';
import { SMS_TABS } from '@/app/nav';
import { SmsPairingProvider } from '@/components/SmsPairing/SmsPairing';
import { SmsSectionHead } from '@/components/SmsSection/SmsSection';
import { Tabs } from '@/components/Tabs/Tabs';
import { smsConnectionSummary } from '@/lib/domain/smsReview';
import { smsDeviceRows, smsTabCounts } from '@/lib/queries/sms';

export default function SmsLayout({ children }: { children: ReactNode }) {
  const counts = smsTabCounts();
  const tabCounts: Record<string, number> = {
    '/money/sms': counts.pending,
    '/money/sms/devices': counts.requests,
  };
  const tabs = SMS_TABS.map((tab) => ({ ...tab, count: tabCounts[tab.href] }));

  return (
    <SmsPairingProvider>
      <div className="wrap page-body stack">
        <SmsSectionHead status={smsConnectionSummary(smsDeviceRows())} />
        <Tabs tabs={tabs} label="SMS views" variant="view" />
        {children}
      </div>
    </SmsPairingProvider>
  );
}
