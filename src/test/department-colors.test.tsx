import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AvatarInitials } from '@/components/AvatarInitials';
import { DepartmentBadge } from '@/components/DepartmentBadge';
import { useDepartmentColors } from '@/hooks/useDepartmentColors';
import { departmentService } from '@/services/departmentService';

// The live department list, mirroring what GET /api/v1/departments returns.
const LIVE_DEPARTMENTS = [
  { id: 'd-eng', name: 'Maintainance', color: '#3B82F6', employeeCount: 4 },
  { id: 'd-qa', name: 'QA', color: '#06B6D4', employeeCount: 2 },
  { id: 'd-sales', name: 'Sales', color: '#F59E0B', employeeCount: 3 },
];

function Directory() {
  const { getColor } = useDepartmentColors();
  return (
    <div>
      <AvatarInitials name="Test User" department="Maintainance" color={getColor('Maintainance')} />
      <AvatarInitials name="QA User" department="QA" color={getColor('QA')} />
      <AvatarInitials name="No Dept" />
      <DepartmentBadge department="Maintainance" color={getColor('Maintainance')} />
      <DepartmentBadge department="QA" color={getColor('QA')} />
      <DepartmentBadge department="Unknown" color={getColor('Unknown')} />
    </div>
  );
}

// The avatars render in order, so index into them.
const avatars = () => screen.getAllByTestId('avatar-initials');

describe('department colors come from live API data', () => {
  beforeEach(() => {
    vi.spyOn(departmentService, 'getAll').mockResolvedValue(LIVE_DEPARTMENTS);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the API color for a renamed department (not in any static map)', async () => {
    render(<Directory />);

    await waitFor(() => {
      // "Maintainance" was renamed from "Engineering" — the old static map had no
      // entry for it, so this is the exact regression case.
      expect(screen.getByText('Maintainance')).toBeInTheDocument();
    });

    // Avatar for Maintainance carries the live blue.
    expect(avatars()[0].style.backgroundColor).toBe('rgb(59, 130, 246)');

    // Badge for Maintainance is tinted with the same blue.
    const maintainanceBadge = screen.getByText('Maintainance');
    expect(maintainanceBadge.style.color).toBe('rgb(59, 130, 246)');
    expect(maintainanceBadge.style.backgroundColor).toBe('rgba(59, 130, 246, 0.094)');
  });

  it('renders a newly added department in its own color', async () => {
    render(<Directory />);

    await waitFor(() => {
      expect(screen.getByText('QA')).toBeInTheDocument();
    });

    expect(avatars()[1].style.backgroundColor).toBe('rgb(6, 182, 212)');

    const qaBadge = screen.getByText('QA');
    expect(qaBadge.style.color).toBe('rgb(6, 182, 212)');
    expect(qaBadge.style.backgroundColor).toBe('rgba(6, 182, 212, 0.094)');
  });

  it('falls back to grey / unstyled for an unknown or absent department', async () => {
    render(<Directory />);

    await waitFor(() => {
      expect(screen.getByText('Unknown')).toBeInTheDocument();
    });

    // Avatar with no color prop -> neutral grey.
    expect(avatars()[2].style.backgroundColor).toBe('rgb(107, 114, 128)');

    // Badge with an unknown department -> no tint, but still legible text.
    const unknownBadge = screen.getByText('Unknown');
    expect(unknownBadge.style.backgroundColor).toBe('');
    expect(unknownBadge.style.color).toBe('');
  });

  it('does not crash when the department fetch fails', async () => {
    vi.spyOn(departmentService, 'getAll').mockRejectedValue(new Error('network down'));

    render(<Directory />);

    await waitFor(() => {
      expect(screen.getByText('Maintainance')).toBeInTheDocument();
    });

    // Falls back to grey rather than breaking the page.
    expect(avatars()[0].style.backgroundColor).toBe('rgb(107, 114, 128)');
  });
});
