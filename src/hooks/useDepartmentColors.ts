import { useEffect, useMemo, useState } from 'react';
import { departmentService } from '@/services/departmentService';
import type { Department } from '@/data/mockData';

/**
 * Live department-name -> color map.
 *
 * Replaces the hardcoded `DEPARTMENT_COLORS` map, which went stale as soon as a
 * department was added or renamed (a renamed department rendered with NO color).
 * Colors are now read from the API so they always match the database.
 */
export function useDepartmentColors() {
  const [departments, setDepartments] = useState<Department[]>([]);

  useEffect(() => {
    let cancelled = false;
    departmentService
      .getAll()
      .then(list => { if (!cancelled) setDepartments(list); })
      .catch(() => { if (!cancelled) setDepartments([]); });
    return () => { cancelled = true; };
  }, []);

  const colors = useMemo(
    () => Object.fromEntries(departments.map(d => [d.name, d.color])),
    [departments],
  );

  // undefined for an unknown/absent department so callers can let the badge
  // render unstyled and the avatar use its grey default.
  const getColor = (department?: string) =>
    department ? colors[department] : undefined;

  return { colors, getColor };
}
