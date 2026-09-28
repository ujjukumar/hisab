'use client';

import { useState } from 'react';
import { Button } from '@/components/Button/Button';
import { Chips } from '@/components/Chips/Chips';
import { Drawer, FieldPair, FormTotal } from '@/components/Drawer/Drawer';
import { AmountField, FieldError, SelectField, TextField } from '@/components/Field/Field';
import { Menu } from '@/components/Menu/Menu';
import { Segmented } from '@/components/Segmented/Segmented';
import { useToast } from '@/components/Toast/Toast';

/** The parts of the kit that need state, so /dev/ui can exercise them. */
export function Interactive() {
  const [range, setRange] = useState<'6' | '12'>('12');
  const [kind, setKind] = useState<'income' | 'expense' | 'transfer'>('expense');
  const [open, setOpen] = useState(false);
  const toast = useToast();

  return (
    <>
      <Chips
        items={[
          { value: '6', label: '6M' },
          { value: '12', label: '1Y' },
        ]}
        value={range}
        onChange={setRange}
        label="Time range"
      />

      <div style={{ marginTop: 16, maxWidth: 380 }}>
        <Segmented
          items={[
            { value: 'income', label: 'Income' },
            { value: 'expense', label: 'Spending' },
            { value: 'transfer', label: 'Transfer' },
          ]}
          value={kind}
          onChange={setKind}
          label="Transaction type"
        />
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 16, alignItems: 'center' }}>
        <Button onClick={() => setOpen(true)} icon="plus">
          Open drawer
        </Button>
        <Button variant="secondary" onClick={() => toast('Transaction saved')}>
          Show toast
        </Button>
        <Menu
          label="Row actions"
          items={[
            { label: 'Edit', onSelect: () => toast('Edit chosen') },
            { label: 'Duplicate', onSelect: () => toast('Duplicate chosen') },
            { label: 'Delete', onSelect: () => toast('Delete chosen'), danger: true },
          ]}
        />
      </div>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Add transaction"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setOpen(false);
                toast('Transaction saved');
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <Segmented
          items={[
            { value: 'income', label: 'Income' },
            { value: 'expense', label: 'Spending' },
            { value: 'transfer', label: 'Transfer' },
          ]}
          value={kind}
          onChange={setKind}
          label="Transaction type"
        />
        <AmountField label="Amount" name="amount" defaultValue="2,140" />
        <FieldError>Enter an amount greater than zero.</FieldError>
        <FieldPair>
          <TextField label="Date" name="date" type="date" defaultValue="2026-09-27" />
          <SelectField label="Account" name="account" defaultValue="card">
            <option value="salary">Salary account</option>
            <option value="card">Credit card</option>
            <option value="cash">Cash</option>
          </SelectField>
        </FieldPair>
        <TextField label="Description" name="description" defaultValue="Weekend groceries" />
        <FormTotal label="Total" value="₹2,140" />
      </Drawer>
    </>
  );
}
