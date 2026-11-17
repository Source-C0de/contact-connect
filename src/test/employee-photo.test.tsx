import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AvatarInitials } from '@/components/AvatarInitials';
import { employeeService } from '@/services/employeeService';
import { api } from '@/lib/api';
import { API_ORIGIN } from '@/lib/apiBase';

// The avatars render in order, so index into them.
const avatars = () => screen.getAllByTestId('avatar-initials');

describe('employee profile pictures', () => {
  beforeEach(() => {
    // The API returns the raw server-relative path; the service is
    // responsible for making it absolute.
    vi.spyOn(employeeService, 'getAll').mockResolvedValue([
      {
        id: 'e-1',
        fullName: 'Fahmim Mohammod Shahriar',
        jobTitle: 'Engineer',
        department: 'IT',
        email: 'fahmim@corp.com',
        extension: '1234',
        mobile: '',
        location: 'Dubai',
        status: 'active',
        onlineStatus: 'online',
        dateAdded: '2026-01-01',
        photoUrl: `${API_ORIGIN}/api/v1/uploads/e-1.png?v=1`,
      },
      {
        id: 'e-2',
        fullName: 'No Picture Person',
        jobTitle: 'Manager',
        department: 'HR',
        email: 'nopicture@corp.com',
        extension: '4321',
        mobile: '',
        location: 'Muscat',
        status: 'active',
        onlineStatus: 'offline',
        dateAdded: '2026-01-02',
      },
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the employee picture beside the name instead of the initials', async () => {
    const employees = await employeeService.getAll();
    render(
      <div>
        {employees.map(emp => (
          <div key={emp.id}>
            <AvatarInitials name={emp.fullName} src={emp.photoUrl} />
            <span>{emp.fullName}</span>
          </div>
        ))}
      </div>,
    );

    await waitFor(() => {
      expect(screen.getByText('Fahmim Mohammod Shahriar')).toBeInTheDocument();
    });

    // The employee WITH a picture shows an <img>.
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', `${API_ORIGIN}/api/v1/uploads/e-1.png?v=1`);
    expect(img).toHaveAttribute('alt', 'Fahmim Mohammod Shahriar');
  });

  it('shows the initials for an employee without a picture', async () => {
    const employees = await employeeService.getAll();
    render(
      <div>
        {employees.map(emp => (
          <div key={emp.id}>
            <AvatarInitials name={emp.fullName} src={emp.photoUrl} />
            <span>{emp.fullName}</span>
          </div>
        ))}
      </div>,
    );

    await waitFor(() => {
      expect(screen.getByText('No Picture Person')).toBeInTheDocument();
    });

    // Only ONE image exists (the first employee) — the second has none.
    expect(screen.getAllByRole('img')).toHaveLength(1);
    expect(avatars()[1]).toHaveTextContent('NP');
  });
});

describe('employee photo mapping (server payload -> Employee)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('turns the server-relative photo path into an absolute URL', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: [
        {
          id: 'e-1',
          fullName: 'Fahmim Mohammod Shahriar',
          jobTitle: 'Engineer',
          department: 'IT',
          email: 'fahmim@corp.com',
          extension: '1234',
          status: 'active',
          created_at: '2026-01-01T00:00:00.000Z',
          photoUrl: '/api/v1/uploads/e-1.png?v=1764',
        },
      ],
      total: 1,
      page: 1,
      page_size: 1,
      total_pages: 1,
    } as never);

    const [emp] = await employeeService.getAll();

    expect(emp.photoUrl).toBe(`${API_ORIGIN}/api/v1/uploads/e-1.png?v=1764`);
  });

  it('leaves the photo undefined when the employee has none', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: [
        {
          id: 'e-2',
          fullName: 'No Picture',
          jobTitle: 'Manager',
          department: 'HR',
          email: 'nopicture@corp.com',
          extension: '4321',
          status: 'active',
          created_at: '2026-01-01T00:00:00.000Z',
        },
      ],
      total: 1,
      page: 1,
      page_size: 1,
      total_pages: 1,
    } as never);

    const [emp] = await employeeService.getAll();

    expect(emp.photoUrl).toBeUndefined();
  });
});
