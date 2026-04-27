import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Table, TableBody } from '@/components/ui/table';
import { AuditRow } from './audit-row';
import { sampleAuditEntries } from './__fixtures__';

function renderRow(entry: (typeof sampleAuditEntries)[number], userMap: Record<string, string> = {}) {
  return render(
    <Table>
      <TableBody>
        <AuditRow entry={entry} userMap={userMap} />
      </TableBody>
    </Table>,
  );
}

describe('AuditRow', () => {
  it('renders username from userMap when actor_user_id is known', () => {
    renderRow(sampleAuditEntries[0], { u1: 'burak' });
    expect(screen.getByText('burak')).toBeInTheDocument();
  });

  it('falls back to "Sistem" when actor_user_id is null', () => {
    const systemEntry = sampleAuditEntries.find((e) => e.actor_user_id == null)!;
    renderRow(systemEntry, {});
    expect(screen.getByText('Sistem')).toBeInTheDocument();
  });

  it('falls back to "silinmiş kullanıcı" when actor_user_id missing from userMap', () => {
    const orphan = sampleAuditEntries.find((e) => e.actor_user_id === 'u-deleted')!;
    renderRow(orphan, { u1: 'burak' }); // u-deleted not in map
    expect(screen.getByText('silinmiş kullanıcı')).toBeInTheDocument();
  });

  it('expands inline JSON details on chevron click', async () => {
    const user = userEvent.setup();
    const entryWithDetails = sampleAuditEntries.find((e) => e.action === 'admin.role_granted')!;
    renderRow(entryWithDetails, { u1: 'burak' });

    const toggle = screen.getByRole('button', { name: /detayları göster/i });
    await user.click(toggle);

    // Check that details JSON appears (Collapsible animations may keep both rendered;
    // we look for the role key in the rendered text)
    expect(screen.getByText(/"role"/)).toBeInTheDocument();
    expect(screen.getByText(/"write"/)).toBeInTheDocument();
  });

  it('does not render expand button when entry has no details', () => {
    const noDetails = {
      ...sampleAuditEntries[0],
      details: {},
      ip_address: null,
      user_agent: null,
    };
    renderRow(noDetails, { u1: 'burak' });
    expect(
      screen.queryByRole('button', { name: /detayları göster/i }),
    ).not.toBeInTheDocument();
  });

  it('truncates long resource_id and exposes full UUID in title', () => {
    const longId = sampleAuditEntries.find((e) => e.action === 'admin.role_granted')!;
    renderRow(longId, { u1: 'burak' });
    // resource_type:short… in cell
    const cell = screen.getByText(/user:00000000…/);
    expect(within(cell).getByText(/user:00000000…/)).toBeInTheDocument();
    // full UUID in title attribute
    expect(cell).toHaveAttribute('title', '00000000-0000-0000-0000-000000000abc');
  });
});
