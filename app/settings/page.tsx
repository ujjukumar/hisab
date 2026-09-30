import { Button, ButtonLink } from '@/components/Button/Button';
import { Card } from '@/components/Card/Card';
import { PageHead } from '@/components/PageHead/PageHead';
import {
  PreferencesForm,
  RestoreForm,
  SettingRow,
  StartFreshForm,
} from '@/components/SettingsForms/SettingsForms';
import {
  databaseInfo,
  defaultCompounding,
  financialYearStartMonth,
  isSampleData,
} from '@/lib/queries/settings';
import { version } from '@/package.json';
import styles from './page.module.css';

const size = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export default async function SettingsPage() {
  const [sample, startMonth, compounding] = await Promise.all([
    isSampleData(),
    financialYearStartMonth(),
    defaultCompounding(),
  ]);
  const info = databaseInfo();

  return (
    <>
      <PageHead title="Settings" />
      <div className="wrap page-body">
        <div className="stack">
          <Card title="Data" sub="Everything is kept in one file on this computer.">
            <SettingRow
              title="Back up now"
              control={
                <form method="post" action="/api/backup">
                  <Button type="submit" variant="secondary" icon="download">
                    Back up now
                  </Button>
                </form>
              }
            >
              <p>
                Saves a copy to <code>{info.backups}</code> and downloads the same file. Keep one
                somewhere safe, such as a USB drive.
              </p>
            </SettingRow>
            <SettingRow title="Restore from backup" control={<RestoreForm />}>
              <p>
                Replaces all your data with the backup&rsquo;s. The file is checked first, and your
                current data is saved to the backups folder before anything changes.
              </p>
            </SettingRow>
            <SettingRow
              title="Export everything as CSV"
              control={
                <ButtonLink variant="secondary" icon="download" download href="/api/export/all">
                  Export everything
                </ButtonLink>
              }
            >
              <p>
                A zip with one spreadsheet file per table, for your own analysis. Amounts are in
                paise. To move your data to another computer, use a backup instead.
              </p>
            </SettingRow>
            <SettingRow
              title={
                sample ? 'Remove sample data and start fresh' : 'Delete all data and start fresh'
              }
              control={<StartFreshForm sample={sample} />}
            >
              <p>
                {sample
                  ? 'Deletes the invented sample accounts, transactions and investments, and puts back the default categories.'
                  : 'Deletes every account, transaction, budget and investment, and puts back the default categories.'}{' '}
                A backup is saved first.
              </p>
            </SettingRow>
          </Card>

          <Card title="Preferences">
            <SettingRow
              title="Financial year and deposits"
              control={<PreferencesForm startMonth={startMonth} compounding={compounding} />}
            >
              <p>
                The financial year decides which months make up a year on Reports, Money and
                Performance. New fixed deposits start with the compounding you choose here; you can
                still change it for each deposit.
              </p>
            </SettingRow>
          </Card>

          <Card title="About">
            <dl className={styles.about}>
              <dt>Database file</dt>
              <dd>
                <code>{info.path}</code> · {size(info.bytes)}
              </dd>
              <dt>Backups folder</dt>
              <dd>
                <code>{info.backups}</code> ·{' '}
                {info.backupCount === 1 ? '1 backup' : `${info.backupCount} backups`}
              </dd>
              <dt>App version</dt>
              <dd>{version}</dd>
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}
