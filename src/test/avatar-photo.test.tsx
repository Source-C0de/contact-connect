import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AvatarInitials } from '@/components/AvatarInitials';
import { mapSystemUser } from '@/services/adminService';
import { mapBackendUser } from '@/services/authService';
import { API_ORIGIN } from '@/lib/apiBase';

// The avatars render in order, so index into them.
const avatars = () => screen.getAllByTestId('avatar-initials');

describe('AvatarInitials with a profile picture', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the coloured background on the testid element (existing contract)', () => {
    render(<AvatarInitials name="Test User" color="#3B82F6" />);

    // The element carrying data-testid="avatar-initials" must be the
    // coloured div, NOT the <img> — the department-colors test asserts on
    // .style.backgroundColor.
    expect(avatars()[0].style.backgroundColor).toBe('rgb(59, 130, 246)');
  });

  it('renders an <img> with the given src when one is supplied', () => {
    const src = `${API_ORIGIN}/api/v1/uploads/u-1.webp`;
    render(<AvatarInitials name="Test User" src={src} />);

    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', src);
    expect(img).toHaveAttribute('alt', 'Test User');
  });

  it('renders initials and no image when src is absent', () => {
    render(<AvatarInitials name="Test User" />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(avatars()[0]).toHaveTextContent('TU');
  });

  it('falls back to the initials when the image fails to load', async () => {
    render(<AvatarInitials name="Test User" src={`${API_ORIGIN}/api/v1/uploads/broken.webp`} />);

    const img = screen.getByRole('img');
    fireEvent.error(img);

    await waitFor(() => {
      expect(screen.queryByRole('img')).not.toBeInTheDocument();
    });
    expect(avatars()[0]).toHaveTextContent('TU');
  });
});

describe('profile picture mapping', () => {
  it('maps the admin user list photo into an absolute URL', () => {
    const mapped = mapSystemUser({
      id: 'u-1',
      email: 'a@b.com',
      name: 'A B',
      role: 'user',
      isActive: true,
      photoUrl: '/api/v1/uploads/u-1.webp',
    });

    expect(mapped.photoUrl).toBe(`${API_ORIGIN}/api/v1/uploads/u-1.webp`);
  });

  it('leaves the photo undefined when the user has none', () => {
    const mapped = mapSystemUser({
      id: 'u-1',
      email: 'a@b.com',
      role: 'user',
      isActive: true,
    });

    expect(mapped.photoUrl).toBeUndefined();
  });

  it('maps the signed-in user photo into an avatar URL', () => {
    const mapped = mapBackendUser({
      user_id: 'u-1',
      email: 'a@b.com',
      name: 'A B',
      role: 'user',
      photo_url: '/api/v1/uploads/u-1.webp',
    });

    expect(mapped.avatar).toBe(`${API_ORIGIN}/api/v1/uploads/u-1.webp`);
  });
});
