import { useState, useEffect } from 'react';
import { departmentService } from '@/services/departmentService';
import type { Department } from '@/data/mockData';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmModal } from '@/components/ConfirmModal';
import { Plus, Pencil, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';

const colorOptions = ['#3B82F6', '#F59E0B', '#EC4899', '#10B981', '#8B5CF6', '#F97316', '#EF4444', '#06B6D4'];

export default function DepartmentManagement() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editDept, setEditDept] = useState<Department | null>(null);
  const [deleteDept, setDeleteDept] = useState<Department | null>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState(colorOptions[0]);

  useEffect(() => { departmentService.getAll().then(setDepartments); }, []);

  const handleAdd = async () => {
    if (!name.trim()) return;
    await departmentService.create(name.trim(), color);
    setDepartments(await departmentService.getAll());
    setShowAdd(false);
    setName('');
    toast.success('Department added');
  };

  const handleRename = async () => {
    if (!editDept || !name.trim()) return;
    await departmentService.rename(editDept.id, name.trim());
    setDepartments(await departmentService.getAll());
    setEditDept(null);
    setName('');
    toast.success('Department renamed');
  };

  const handleDelete = async () => {
    if (!deleteDept) return;
    await departmentService.delete(deleteDept.id);
    setDepartments(await departmentService.getAll());
    setDeleteDept(null);
    toast.success('Department deleted');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Departments</h1>
          <p className="text-sm text-muted-foreground">Manage organizational departments</p>
        </div>
        <Button onClick={() => { setName(''); setColor(colorOptions[0]); setShowAdd(true); }}>
          <Plus className="mr-2 h-4 w-4" /> Add Department
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {departments.map(dept => (
          <div key={dept.id} className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="h-3 w-3 rounded-full" style={{ backgroundColor: dept.color }} />
              <h3 className="text-lg font-semibold text-foreground">{dept.name}</h3>
            </div>
            <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <Users className="h-4 w-4" />
              <span>{dept.employeeCount} employees</span>
            </div>
            <div className="mt-4 flex gap-2">
              <Button size="sm" variant="outline" onClick={() => { setEditDept(dept); setName(dept.name); }}>
                <Pencil className="mr-1 h-3.5 w-3.5" /> Rename
              </Button>
              <Button size="sm" variant="outline" onClick={() => setDeleteDept(dept)} className="text-destructive hover:text-destructive">
                <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* Add Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Department</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Department name" />
            </div>
            <div className="space-y-2">
              <Label>Color</Label>
              <div className="flex gap-2">
                {colorOptions.map(c => (
                  <button key={c} onClick={() => setColor(c)} className={`h-8 w-8 rounded-full border-2 ${color === c ? 'border-foreground' : 'border-transparent'}`} style={{ backgroundColor: c }} />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={handleAdd}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Dialog */}
      <Dialog open={!!editDept} onOpenChange={() => setEditDept(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Rename Department</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>New Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDept(null)}>Cancel</Button>
            <Button onClick={handleRename}>Rename</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmModal
        open={!!deleteDept}
        onOpenChange={() => setDeleteDept(null)}
        title="Delete Department"
        description={`Are you sure you want to delete "${deleteDept?.name}"? This cannot be undone.`}
        onConfirm={handleDelete}
        confirmLabel="Delete"
        destructive
      />
    </div>
  );
}
