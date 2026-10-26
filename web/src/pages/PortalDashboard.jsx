import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  cancelBooking,
  changePassword,
  checkInBooking,
  checkOutBooking,
  checkOutVisitor,
  createBlock,
  createHostel,
  createManualPayment,
  createMaintenance,
  createNotice,
  createRoom,
  createRoomType,
  createSemester,
  createStaff,
  createSecurity,
  createVisitor,
  createFloor,
  deactivateStaff,
  activateSemester,
  closeSemester,
  decideRoomChange,
  getAdminPayments,
  getAdminReport,
  getAdminStaff,
  getAdminPaymentsCsv,
  getAuditLogs,
  getBlocks,
  getFloors,
  getHostels,
  getMaintenance,
  getMyBookings,
  getMyPayments,
  getRoomChangeRequests,
  downloadReceipt,
  getNotices,
  getRoomAvailability,
  getRoomTypes,
  getSemesters,
  getStudentDashboard,
  getStudents,
  getVisitors,
  holdBed,
  initializePayment,
  requestRoomChange,
  updateMaintenance,
  updateRoomPrice,
} from '../services/hostelApi';

const money = (pesewas) => `GHS ${(Number(pesewas || 0) / 100).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const randomKey = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function Field({ label, children }) {
  return <div className="form-group"><label>{label}</label>{children}</div>;
}

function PortalDashboard({ user, onLogout, onEnable2FA }) {
  const [tab, setTab] = useState(user.role === 'STUDENT' ? 'home' : user.role === 'ADMIN' ? 'overview' : 'students');
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [studentDash, setStudentDash] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [myPayments, setMyPayments] = useState([]);
  const [roomTypes, setRoomTypes] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [report, setReport] = useState(null);
  const [adminPayments, setAdminPayments] = useState([]);
  const [staffAccounts, setStaffAccounts] = useState([]);
  const [students, setStudents] = useState([]);
  const [maintenance, setMaintenance] = useState([]);
  const [visitors, setVisitors] = useState([]);
  const [, setNotices] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [semesters, setSemesters] = useState([]);
  const [hostels, setHostels] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [floors, setFloors] = useState([]);
  const [roomChangeRequests, setRoomChangeRequests] = useState([]);
  const [selectedSemester, setSelectedSemester] = useState('');
  const [selectedType, setSelectedType] = useState('');
  const [selectedBooking, setSelectedBooking] = useState('');
  const [phone, setPhone] = useState(user.phone || '');
  const [paymentGhs, setPaymentGhs] = useState('');
  const [network, setNetwork] = useState('MTN_MOMO');
  const [studentQuery, setStudentQuery] = useState('');
  const [noticeDraft, setNoticeDraft] = useState({ title: '', body: '' });
  const [visitorDraft, setVisitorDraft] = useState({ fullName: '', studentId: '', identityRef: '', purpose: '' });
  const [maintenanceDraft, setMaintenanceDraft] = useState({ title: '', description: '' });
  const [staffDraft, setStaffDraft] = useState({ fullName: '', email: '', temporaryPassword: '' });
  const [securityDraft, setSecurityDraft] = useState({ fullName: '', email: '', temporaryPassword: '' });
  const [roomTypeDraft, setRoomTypeDraft] = useState({ name: '', capacity: '', priceGhs: '' });
  const [semesterDraft, setSemesterDraft] = useState({ name: '', startsAt: '', endsAt: '', balanceDueAt: '', depositPercent: '50' });
  const [structureDraft, setStructureDraft] = useState({ hostelName: '', blockName: '', gender: 'MIXED', floorName: 'Ground Floor', roomNumber: '', roomTypeId: '' });
  const [manualDraft, setManualDraft] = useState({ amountGhs: '', source: 'MANUAL_CASH', network: 'MTN_MOMO', reference: '' });
  const [mustChangePassword, setMustChangePassword] = useState(Boolean(user.mustChangePassword));
  const [passwordDraft, setPasswordDraft] = useState({ currentPassword: '', password: '', confirmPassword: '' });

  const isAdmin = user.role === 'ADMIN';
  const isStaff = user.role === 'STAFF';
  const isStudent = user.role === 'STUDENT';
  const isSecurity = user.role === 'SECURITY';
  const tabs = isStudent
    ? [['home', 'My stay'], ['rooms', 'Find a room'], ['payments', 'Payments'], ['service', 'Notices & service']]
    : isAdmin
      ? [['overview', 'Overview'], ['rooms', 'Rooms & prices'], ['students', 'Students'], ['payments', 'Payments'], ['operations', 'Operations'], ['team', 'Staff & audit']]
      : isSecurity
        ? [['operations', 'Visitors']]
        : [['students', 'Students'], ['operations', 'Front desk']];

  useEffect(() => {
    let active = true;
    async function loadPortal() {
      setLoading(true);
      setError('');
      const tasks = isStudent
        ? [getStudentDashboard(), getMyBookings(), getMyPayments(), getRoomTypes(), getRoomAvailability()]
        : isAdmin
          ? [getAdminReport(selectedSemester || undefined), getAdminPayments(selectedSemester || undefined), getAdminStaff(), getStudents(), getMaintenance(), getVisitors(), getNotices(), getAuditLogs(), getSemesters(), getRoomTypes(selectedSemester || undefined), getRoomAvailability(selectedSemester ? { semesterId: selectedSemester } : {}), getHostels(), getBlocks(), getFloors(), getRoomChangeRequests()]
          : [getStudents(), getMaintenance(), getVisitors(), getNotices()];
      const results = await Promise.allSettled(tasks);
      if (!active) return;
      const errors = [];
      const setFulfilled = (index, setter, key) => {
        const result = results[index];
        if (result?.status === 'fulfilled') setter(key ? result.value[key] : result.value);
        else if (result?.status === 'rejected') errors.push(result.reason?.message || 'Some information could not be loaded.');
      };

      if (isStudent) {
        setFulfilled(0, setStudentDash);
        setFulfilled(1, setBookings, 'bookings');
        setFulfilled(2, setMyPayments, 'payments');
        setFulfilled(3, setRoomTypes, 'roomTypes');
        setFulfilled(4, setRooms, 'rooms');
      } else if (isAdmin) {
        setFulfilled(0, setReport);
        setFulfilled(1, setAdminPayments, 'payments');
        setFulfilled(2, setStaffAccounts, 'staff');
        setFulfilled(3, setStudents, 'students');
        setFulfilled(4, setMaintenance, 'requests');
        setFulfilled(5, setVisitors, 'visitors');
        setFulfilled(6, setNotices, 'notices');
        setFulfilled(7, setAuditLogs, 'logs');
        setFulfilled(8, setSemesters, 'semesters');
        setFulfilled(9, setRoomTypes, 'roomTypes');
        setFulfilled(10, setRooms, 'rooms');
        setFulfilled(11, setHostels, 'hostels');
        setFulfilled(12, setBlocks, 'blocks');
        setFulfilled(13, setFloors, 'floors');
        setFulfilled(14, setRoomChangeRequests, 'requests');
      } else {
        setFulfilled(0, setStudents, 'students');
        setFulfilled(1, setMaintenance, 'requests');
        setFulfilled(2, setVisitors, 'visitors');
        setFulfilled(3, setNotices, 'notices');
      }
      setError(errors[0] || '');
      setLoading(false);
    }
    void loadPortal();
    return () => { active = false; };
  }, [isAdmin, isStudent, selectedSemester, reload]);

  async function runAction(action, successMessage) {
    setError('');
    try {
      await action();
      if (successMessage) window.alert(successMessage);
      setReload((value) => value + 1);
    } catch (failure) {
      setError(failure.message || 'The action could not be completed.');
    }
  }

  async function bookRoom(roomId) {
    const room = rooms.find((entry) => entry.id === roomId);
    await runAction(async () => {
      const result = await holdBed({ roomTypeId: room?.roomTypeId || selectedType, roomId: roomId || undefined, semesterId: studentDash?.semester?.id });
      setSelectedBooking(result.booking.id);
      window.alert(`Bed held in room ${result.booking.room.roomNumber} until ${new Date(result.booking.holdExpiresAt).toLocaleTimeString()}. Pay the required deposit before the hold expires.`);
    });
  }

  async function startPayment(event) {
    event.preventDefault();
    const booking = bookings.find((entry) => selectedBooking
      ? entry.id === selectedBooking
      : ['HELD', 'CONFIRMED'].includes(entry.status));
    if (!booking) return setError('Hold a bed before starting payment.');
    const amountPesewas = Math.round(Number(paymentGhs) * 100);
    if (!Number.isSafeInteger(amountPesewas) || amountPesewas <= 0) return setError('Enter a valid payment amount.');
    await runAction(async () => {
      const result = await initializePayment({ bookingId: booking.id, amountPesewas, network, phone: phone.trim(), idempotencyKey: randomKey() });
      window.alert(result.message || 'Approve the mobile-money prompt on your phone.');
    });
  }

  async function searchStudents(event) {
    event.preventDefault();
    await runAction(async () => setStudents((await getStudents(studentQuery.trim())).students));
  }

  async function submitManualPayment(event, bookingId) {
    event.preventDefault();
    await runAction(async () => {
      await createManualPayment({
        bookingId,
        amountPesewas: Math.round(Number(manualDraft.amountGhs) * 100),
        source: manualDraft.source,
        network: manualDraft.source === 'MANUAL_MOMO' ? manualDraft.network : undefined,
        momoReference: manualDraft.reference || undefined,
      });
      setManualDraft({ amountGhs: '', source: 'MANUAL_CASH', network: 'MTN_MOMO', reference: '' });
    }, 'Manual payment recorded.');
  }

  async function createInventory(event) {
    event.preventDefault();
    await runAction(async () => {
      let hostel = hostels[0];
      if (structureDraft.hostelName.trim()) hostel = (await createHostel({ name: structureDraft.hostelName.trim() })).hostel;
      if (!hostel) throw new Error('Create or select a hostel before adding a block.');
      let block = blocks.find((entry) => entry.hostelId === hostel.id && entry.name === structureDraft.blockName);
      if (!block) block = (await createBlock({ hostelId: hostel.id, name: structureDraft.blockName.trim(), gender: structureDraft.gender })).block;
      let floor = floors.find((entry) => entry.blockId === block.id && entry.name === structureDraft.floorName);
      if (!floor) floor = (await createFloor({ blockId: block.id, name: structureDraft.floorName.trim() })).floor;
      await createRoom({ floorId: floor.id, roomTypeId: structureDraft.roomTypeId, roomNumber: structureDraft.roomNumber.trim() });
      setStructureDraft({ ...structureDraft, hostelName: '', roomNumber: '' });
    }, 'Room created with beds based on its room type.');
  }

  async function createType(event) {
    event.preventDefault();
    const activeSemester = semesters.find((semester) => semester.status === 'ACTIVE');
    if (!activeSemester) return setError('Create and activate a semester before setting room prices.');
    await runAction(async () => {
      await createRoomType({ name: roomTypeDraft.name.trim(), capacity: Number(roomTypeDraft.capacity), semesterId: activeSemester.id, pricePesewas: Math.round(Number(roomTypeDraft.priceGhs) * 100) });
      setRoomTypeDraft({ name: '', capacity: '', priceGhs: '' });
    }, 'Room type and semester price created.');
  }

  async function submitSemester(event) {
    event.preventDefault();
    await runAction(async () => {
      await createSemester({
        name: semesterDraft.name.trim(),
        startsAt: new Date(`${semesterDraft.startsAt}T00:00:00`).toISOString(),
        endsAt: new Date(`${semesterDraft.endsAt}T23:59:59`).toISOString(),
        balanceDueAt: semesterDraft.balanceDueAt ? new Date(`${semesterDraft.balanceDueAt}T23:59:59`).toISOString() : undefined,
        depositBps: Math.round(Number(semesterDraft.depositPercent) * 100),
      });
      setSemesterDraft({ name: '', startsAt: '', endsAt: '', balanceDueAt: '', depositPercent: '50' });
    }, 'Semester created. Activate it to open bookings.');
  }

  async function createStaffAccount(event) {
    event.preventDefault();
    await runAction(async () => {
      await createStaff(staffDraft);
      setStaffDraft({ fullName: '', email: '', temporaryPassword: '' });
    }, 'Staff account created; password change is required at first sign-in.');
  }

  async function createSecurityAccount(event) {
    event.preventDefault();
    await runAction(async () => {
      await createSecurity(securityDraft);
      setSecurityDraft({ fullName: '', email: '', temporaryPassword: '' });
    }, 'Security account created with visitor and check-in permissions.');
  }

  async function submitVisitor(event) {
    event.preventDefault();
    await runAction(async () => {
      await createVisitor(visitorDraft);
      setVisitorDraft({ fullName: '', studentId: '', identityRef: '', purpose: '' });
    }, 'Visitor arrival recorded.');
  }

  async function submitNotice(event) {
    event.preventDefault();
    await runAction(async () => {
      await createNotice({ ...noticeDraft, targetRoles: [] });
      setNoticeDraft({ title: '', body: '' });
    }, 'Notice published.');
  }

  async function submitForcedPassword(event) {
    event.preventDefault();
    if (passwordDraft.password !== passwordDraft.confirmPassword) return setError('The new passwords do not match.');
    await runAction(async () => {
      await changePassword({ currentPassword: passwordDraft.currentPassword, password: passwordDraft.password });
      setMustChangePassword(false);
      setPasswordDraft({ currentPassword: '', password: '', confirmPassword: '' });
    }, 'Password changed. Your staff access is now available.');
  }

  async function exportPayments() {
    try {
      const response = await getAdminPaymentsCsv(selectedSemester || undefined);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'hostel-payments.csv';
      link.click();
      URL.revokeObjectURL(url);
    } catch (failure) { setError(failure.message || 'Could not export payments.'); }
  }

  function sectionHeader(kicker, title, description, action) {
    return <div className="admin-section-header"><div><span className="eyebrow">{kicker}</span><h2>{title}</h2><p>{description}</p></div>{action}</div>;
  }

  return (
    <div className="dashboard-page hostel-portal">
      <header className="dashboard-topbar">
        <Link className="brand" to="/" aria-label="Hostel Management home"><span className="brand-mark">H</span><span>Hostel Management</span></Link>
        <div className="dashboard-user"><div className="dashboard-user-meta"><strong>{user.name}</strong><span>{user.email}</span></div><span className="role-chip">{user.role}</span>{['ADMIN', 'STAFF'].includes(user.role) && <button className="button button-secondary" type="button" onClick={onEnable2FA}>Security</button>}<button className="button button-secondary" type="button" onClick={onLogout}>Sign out</button></div>
      </header>
      <main className="dashboard">
        <div className="dashboard-heading"><span className="eyebrow">{isAdmin ? 'Administrator portal' : isStaff ? 'Secretary portal' : isSecurity ? 'Security desk' : 'Resident portal'}</span><h1>{isAdmin ? 'Hostel control room' : isStaff ? 'Front desk' : isSecurity ? 'Visitor desk' : `Welcome, ${user.name}`}</h1><p>{isStudent ? 'Your accommodation, payments and resident services.' : isAdmin ? 'Semester operations, occupancy, collections and accountability.' : 'Resident records and daily hostel service operations.'}</p></div>

        <nav className="portal-tabs" aria-label="Portal sections">{tabs.map(([id, label]) => <button key={id} type="button" className={tab === id ? 'is-active' : ''} onClick={() => setTab(id)}>{label}</button>)}</nav>
        {error && <p className="form-error" role="alert">{error}</p>}
        {loading && <p className="form-info" role="status">Loading the latest hostel data…</p>}

        {tab === 'home' && isStudent && (
          <>
            {studentDash?.booking ? <section className="admin-section">
              {sectionHeader('Your accommodation', `Room ${studentDash.booking.roomNumber}`, `${studentDash.booking.block} · ${studentDash.booking.roomType} · Bed ${studentDash.booking.bed}`)}
              <div className="hostel-stats"><article className="hostel-stat"><span>Roommates</span><strong>{studentDash.booking.roommates}</strong></article><article className="hostel-stat"><span>Paid</span><strong>{money(studentDash.booking.totalPaidPesewas)}</strong></article><article className="hostel-stat"><span>Balance</span><strong>{money(studentDash.booking.balancePesewas)}</strong></article><article className="hostel-stat"><span>Payment status</span><strong>{studentDash.booking.paymentStatus}</strong></article></div>
              {studentDash.booking.status === 'HELD' && <p className="form-info">Your bed hold expires {new Date(studentDash.booking.holdExpiresAt).toLocaleString()}.</p>}
              <button className="button button-secondary" type="button" onClick={() => runAction(() => cancelBooking(studentDash.booking.id), 'Booking cancelled.')}>Cancel booking</button>
              {studentDash.booking.payments?.filter((payment) => payment.status === 'SUCCESS').map((payment) => <button key={payment.id} className="button button-secondary receipt-link" type="button" onClick={async () => {
                try {
                  const response = await downloadReceipt(payment.id);
                  const url = URL.createObjectURL(await response.blob());
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = `receipt-${payment.receiptNumber}.pdf`;
                  link.click();
                  URL.revokeObjectURL(url);
                } catch (failure) { setError(failure.message || 'Could not download the receipt.'); }
              }}>Download receipt {payment.receiptNumber}</button>)}
            </section> : <section className="admin-section"><h2>No room booking yet</h2><p>Browse live availability and hold a bed for 30 minutes.</p><button className="button button-primary" type="button" onClick={() => setTab('rooms')}>Find a room</button></section>}
            <section className="admin-section">{sectionHeader('Notices', 'Hostel updates', 'Current notices for residents.')}{studentDash?.notices?.length ? studentDash.notices.map((notice) => <article className="notice-row" key={notice.id}><h3>{notice.title}</h3><p>{notice.body}</p><small>{new Date(notice.publishedAt).toLocaleString()}</small></article>) : <p className="empty-state">No current notices.</p>}</section>
          </>
        )}

        {tab === 'rooms' && (isStudent || isAdmin) && (
          <>
          <section className="admin-section">
            {sectionHeader(isStudent ? 'Room finder' : 'Inventory', 'Rooms and live availability', 'Full rooms cannot be selected. Automatic assignment fills partly occupied rooms first.', <button className="button button-secondary" type="button" onClick={() => setReload((value) => value + 1)}>Refresh</button>)}
            <div className="room-type-filter"><label htmlFor="room-type-filter">Room type</label><select className="form-control" id="room-type-filter" value={selectedType} onChange={(event) => setSelectedType(event.target.value)}><option value="">All room types</option>{roomTypes.map((type) => <option key={type.id} value={type.id}>{type.name} · {money(type.pricePesewas)}</option>)}</select></div>
            {isStudent && <button className="button button-primary assign-button" type="button" disabled={!selectedType || !studentDash?.semester?.id} onClick={() => bookRoom('')}>Assign me a room</button>}
            <div className="room-grid">{rooms.filter((room) => !selectedType || room.roomTypeId === selectedType).map((room) => <article className={`room-tile ${room.available === 0 ? 'is-full' : ''}`} key={room.id}>
              <div><span className="room-block-label">{room.block} · {room.floor}</span><h3>Room {room.roomNumber}</h3></div><span className={`hostel-status ${room.available === 0 ? 'is-occupied' : ''}`}>{room.status.replaceAll('_', ' ')}</span><p>{room.roomType} · {room.taken} of {room.capacity} beds used</p><p>{room.available} {room.available === 1 ? 'bed' : 'beds'} left · {money(room.pricePesewas)} / semester</p>
              {isStudent && <button className="button button-secondary" type="button" disabled={!room.available || !room.pricePesewas} onClick={() => bookRoom(room.id)}>Choose room</button>}
            </article>)}</div>
            {isAdmin && <>
              <h3 className="portal-subheading">Add inventory room</h3>
              <form className="hostel-form" onSubmit={createInventory}>
                <Field label="Hostel (leave blank to use first)"><input className="form-control" value={structureDraft.hostelName} onChange={(event) => setStructureDraft({ ...structureDraft, hostelName: event.target.value })} /></Field>
                <Field label="Block"><input className="form-control" required value={structureDraft.blockName} onChange={(event) => setStructureDraft({ ...structureDraft, blockName: event.target.value })} /></Field>
                <Field label="Block gender"><select className="form-control" value={structureDraft.gender} onChange={(event) => setStructureDraft({ ...structureDraft, gender: event.target.value })}><option value="MIXED">Mixed</option><option value="MALE">Male</option><option value="FEMALE">Female</option></select></Field>
                <Field label="Floor"><input className="form-control" required value={structureDraft.floorName} onChange={(event) => setStructureDraft({ ...structureDraft, floorName: event.target.value })} /></Field>
                <Field label="Room number"><input className="form-control" required value={structureDraft.roomNumber} onChange={(event) => setStructureDraft({ ...structureDraft, roomNumber: event.target.value })} /></Field>
                <Field label="Room type"><select className="form-control" required value={structureDraft.roomTypeId} onChange={(event) => setStructureDraft({ ...structureDraft, roomTypeId: event.target.value })}><option value="">Choose type</option>{roomTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></Field>
                <button className="button button-primary" type="submit">Add room</button>
              </form>
              <h3 className="portal-subheading">Create room type and price</h3>
              <form className="hostel-form" onSubmit={createType}><Field label="Room type name"><input className="form-control" required value={roomTypeDraft.name} onChange={(event) => setRoomTypeDraft({ ...roomTypeDraft, name: event.target.value })} placeholder="e.g. 6 in a room" /></Field><Field label="Capacity"><input className="form-control" required type="number" min="1" max="20" value={roomTypeDraft.capacity} onChange={(event) => setRoomTypeDraft({ ...roomTypeDraft, capacity: event.target.value })} /></Field><Field label="Semester price (GHS)"><input className="form-control" required type="number" min="0.01" step="0.01" value={roomTypeDraft.priceGhs} onChange={(event) => setRoomTypeDraft({ ...roomTypeDraft, priceGhs: event.target.value })} /></Field><button className="button button-primary" type="submit">Create type</button></form>
              <div className="hostel-table-wrap"><table className="hostel-table"><thead><tr><th>Type</th><th>Capacity</th><th>Current price / semester</th><th>Update price</th></tr></thead><tbody>{roomTypes.map((type) => <tr key={type.id}><td>{type.name}</td><td>{type.capacity}</td><td>{money(type.pricePesewas)}</td><td><form className="inline-price-form" onSubmit={(event) => { event.preventDefault(); const price = Number(new FormData(event.currentTarget).get('price')); const semester = semesters.find((entry) => entry.status === 'ACTIVE'); if (!semester) return setError('Activate a semester first.'); void runAction(() => updateRoomPrice(type.id, semester.id, Math.round(price * 100)), 'Price updated for future bookings.'); }}><input className="form-control" name="price" type="number" step="0.01" min="0.01" aria-label={`New price for ${type.name}`} required /><button className="button button-secondary" type="submit">Save</button></form></td></tr>)}</tbody></table></div>
            </>}
          </section>
          {isAdmin && <section className="admin-section">{sectionHeader('Semester setup', 'Manage semesters', 'Deposit rates and due dates are stored per semester.')}
            <form className="hostel-form" onSubmit={submitSemester}><Field label="Semester name"><input className="form-control" required value={semesterDraft.name} onChange={(event) => setSemesterDraft({ ...semesterDraft, name: event.target.value })} /></Field><Field label="Start date"><input className="form-control" type="date" required value={semesterDraft.startsAt} onChange={(event) => setSemesterDraft({ ...semesterDraft, startsAt: event.target.value })} /></Field><Field label="End date"><input className="form-control" type="date" required value={semesterDraft.endsAt} onChange={(event) => setSemesterDraft({ ...semesterDraft, endsAt: event.target.value })} /></Field><Field label="Balance due"><input className="form-control" type="date" value={semesterDraft.balanceDueAt} onChange={(event) => setSemesterDraft({ ...semesterDraft, balanceDueAt: event.target.value })} /></Field><Field label="Minimum deposit (%)"><input className="form-control" type="number" min="10" max="100" required value={semesterDraft.depositPercent} onChange={(event) => setSemesterDraft({ ...semesterDraft, depositPercent: event.target.value })} /></Field><button className="button button-primary" type="submit">Create semester</button></form>
            {semesters.map((semester) => <div className="operation-row" key={semester.id}><strong>{semester.name}</strong><span>{new Date(semester.startsAt).toLocaleDateString()} – {new Date(semester.endsAt).toLocaleDateString()}</span><span>{semester.status}</span>{semester.status !== 'ACTIVE' && semester.status !== 'CLOSED' && <button className="button button-secondary" type="button" onClick={() => runAction(() => activateSemester(semester.id), 'Semester activated.')}>Activate</button>}{semester.status !== 'CLOSED' && <button className="button button-danger" type="button" onClick={() => runAction(() => closeSemester(semester.id), 'Semester closed.')}>Close</button>}</div>)}
          </section>}
          </>
        )}

        {tab === 'payments' && isStudent && <section className="admin-section">{sectionHeader('Payments', 'Make a semester payment', 'Pay through MTN Mobile Money or Telecel Cash. We confirm payment only after provider verification.')}
          <form className="hostel-form" onSubmit={startPayment}><Field label="Booking"><select className="form-control" value={selectedBooking} onChange={(event) => setSelectedBooking(event.target.value)}><option value="">Choose active booking</option>{bookings.filter((booking) => ['HELD', 'CONFIRMED'].includes(booking.status)).map((booking) => <option key={booking.id} value={booking.id}>Room {booking.room} · {booking.semester} · balance {money(booking.balancePesewas)}</option>)}</select></Field><Field label="Mobile money phone"><input className="form-control" required value={phone} onChange={(event) => setPhone(event.target.value)} /></Field><Field label="Network"><select className="form-control" value={network} onChange={(event) => setNetwork(event.target.value)}><option value="MTN_MOMO">MTN Mobile Money</option><option value="TELECEL_CASH">Telecel Cash</option></select></Field><Field label="Amount (GHS)"><input className="form-control" type="number" min="0.01" step="0.01" required value={paymentGhs} onChange={(event) => setPaymentGhs(event.target.value)} /></Field><button className="button button-primary" type="submit">Request payment</button></form>
          <h3 className="portal-subheading">Payment history</h3>{myPayments.map((payment) => <div className="operation-row" key={payment.id}><strong>{money(payment.amountPesewas)}</strong><span>{payment.network || payment.source}</span><span>{payment.status}</span><span>{payment.receiptNumber || payment.paystackReference || 'Pending'}</span></div>)}
        </section>}

        {tab === 'service' && isStudent && <>
          <section className="admin-section">{sectionHeader('Maintenance', 'Request a repair', 'Your request is tied to your active room booking.')}{studentDash?.booking && <form className="form-stack compact-form" onSubmit={(event) => { event.preventDefault(); void runAction(() => createMaintenance({ bookingId: studentDash.booking.id, ...maintenanceDraft }), 'Maintenance request submitted.'); setMaintenanceDraft({ title: '', description: '' }); }}><Field label="Issue"><input className="form-control" required value={maintenanceDraft.title} onChange={(event) => setMaintenanceDraft({ ...maintenanceDraft, title: event.target.value })} /></Field><Field label="Details"><textarea className="form-control" required rows="3" value={maintenanceDraft.description} onChange={(event) => setMaintenanceDraft({ ...maintenanceDraft, description: event.target.value })} /></Field><button className="button button-primary" type="submit">Submit request</button></form>}{(studentDash?.maintenance || []).map((entry) => <div className="operation-row" key={entry.id}><strong>{entry.title}</strong><span>{entry.room.roomNumber}</span><span>{entry.status}</span></div>)}</section>
          <section className="admin-section">{sectionHeader('Notices', 'Hostel notices', 'Updates relevant to your stay.')}{(studentDash?.notices || []).map((notice) => <article className="notice-row" key={notice.id}><h3>{notice.title}</h3><p>{notice.body}</p></article>)}</section>
          {studentDash?.booking && <section className="admin-section">{sectionHeader('Room transfer', 'Request a room change', 'The administrator reviews transfer requests.')}
            <form className="hostel-form" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void runAction(() => requestRoomChange({ bookingId: studentDash.booking.id, requestedRoomId: String(data.get('roomId')), reason: String(data.get('reason')) }), 'Room change request submitted.'); }}><Field label="Available room"><select className="form-control" name="roomId" required><option value="">Choose a room</option>{rooms.filter((room) => room.available > 0).map((room) => <option key={room.id} value={room.id}>{room.block} · {room.roomNumber} · {room.roomType}</option>)}</select></Field><Field label="Reason"><input className="form-control" name="reason" required minLength="5" /></Field><button className="button button-primary" type="submit">Request transfer</button></form>
          </section>}
        </>}

        {tab === 'overview' && isAdmin && <>
          <section className="hostel-stats"><article className="hostel-stat"><span>Registered students</span><strong>{report?.students.totalRegistered ?? '—'}</strong></article><article className="hostel-stat"><span>Booked</span><strong>{report?.students.totalBooked ?? '—'}</strong></article><article className="hostel-stat"><span>Checked in</span><strong>{report?.students.checkedIn ?? '—'}</strong></article><article className="hostel-stat"><span>Collected</span><strong>{money(report?.money.collectedPesewas)}</strong></article><article className="hostel-stat"><span>Outstanding</span><strong>{money(report?.money.outstandingPesewas)}</strong></article><article className="hostel-stat"><span>Collection rate</span><strong>{((report?.money.collectionRateBps || 0) / 100).toFixed(1)}%</strong></article><article className="hostel-stat"><span>Occupancy</span><strong>{((report?.rooms.occupancyBps || 0) / 100).toFixed(1)}%</strong></article><article className="hostel-stat"><span>Reconciliation</span><strong className={report?.money.reconciled ? 'is-reconciled' : 'is-unreconciled'}>{report ? (report.money.reconciled ? 'Matched' : 'Mismatch') : '—'}</strong></article></section>
          <section className="admin-section">{sectionHeader('Semester', report?.semester?.name || 'Select semester', 'Reports and fee totals use the selected semester.', <select className="form-control semester-select" value={selectedSemester || report?.semester?.id || ''} onChange={(event) => setSelectedSemester(event.target.value)}>{semesters.map((semester) => <option key={semester.id} value={semester.id}>{semester.name} · {semester.status}</option>)}</select>)}
            <div className="report-grid"><article><h3>Payment state</h3><p>Complete: {report?.students.paymentStatusCounts.COMPLETE ?? 0}</p><p>Incomplete: {report?.students.paymentStatusCounts.INCOMPLETE ?? 0}</p><p>Unpaid: {report?.students.paymentStatusCounts.UNPAID ?? 0}</p></article><article><h3>Rooms</h3><p>Full: {report?.rooms.full ?? 0}</p><p>Partly filled: {report?.rooms.partlyFilled ?? 0}</p><p>Empty: {report?.rooms.empty ?? 0}</p><p>Beds available: {report?.rooms.availableBeds ?? 0}</p></article><article><h3>Gross and net</h3><p>Gross: {money(report?.money.collectedPesewas)}</p><p>Paystack fees: {money(report?.money.feesPesewas)}</p><p>Net: {money(report?.money.netPesewas)}</p></article></div>
            <button className="button button-secondary" type="button" onClick={exportPayments}>Export payments CSV</button>
          </section>
          <section className="admin-section">{sectionHeader('Outstanding balances', 'Students requiring follow-up', 'Largest balances in the active semester.')}{report?.topBalances?.map((entry) => <div className="operation-row" key={entry.studentId}><strong>{entry.name}</strong><span>{entry.studentId}</span><span>Room {entry.room}</span><span>{money(entry.balancePesewas)}</span></div>)}</section>
        </>}

        {tab === 'students' && !isStudent && !isSecurity && <section className="admin-section">{sectionHeader('Student register', 'Search students', 'Search by student ID, name, or room number.')}
          <form className="search-row" onSubmit={searchStudents}><input className="form-control" aria-label="Search students" placeholder="Student ID, name, or room" value={studentQuery} onChange={(event) => setStudentQuery(event.target.value)} /><button className="button button-primary" type="submit">Search</button></form>
          <div className="hostel-table-wrap"><table className="hostel-table"><thead><tr><th>Student</th><th>ID</th><th>Room</th><th>Payment</th><th>Balance</th><th>Front desk</th></tr></thead><tbody>{students.map((student) => <tr key={student.studentId}><td>{student.name}<span className="user-email">{student.phone}</span></td><td>{student.studentId}</td><td>{student.booking ? `${student.booking.roomNumber} · ${student.booking.status}` : 'Not booked'}</td><td>{student.booking ? money(student.booking.paidPesewas) : '—'}</td><td>{student.booking ? money(student.booking.balancePesewas) : '—'}</td><td>{student.booking && <div className="frontdesk-actions"><button className="button button-secondary" type="button" onClick={() => runAction(() => checkInBooking(student.booking.id), 'Resident checked in.')}>Check in</button><button className="button button-secondary" type="button" onClick={() => runAction(() => checkOutBooking(student.booking.id), 'Resident checked out.')}>Check out</button></div>}</td></tr>)}</tbody></table></div>
          {isStaff && students.some((student) => student.booking) && <><h3 className="portal-subheading">Record an office payment</h3>{students.filter((student) => student.booking).map((student) => <form className="manual-payment-row" key={student.booking.id} onSubmit={(event) => submitManualPayment(event, student.booking.id)}><strong>{student.name} · {student.studentId} · room {student.booking.roomNumber}</strong><input className="form-control" type="number" min="0.01" step="0.01" required placeholder="Amount GHS" value={manualDraft.amountGhs} onChange={(event) => setManualDraft({ ...manualDraft, amountGhs: event.target.value })} /><select className="form-control" value={manualDraft.source} onChange={(event) => setManualDraft({ ...manualDraft, source: event.target.value })}><option value="MANUAL_CASH">Cash</option><option value="MANUAL_MOMO">Office MoMo</option></select>{manualDraft.source === 'MANUAL_MOMO' && <select className="form-control" value={manualDraft.network} onChange={(event) => setManualDraft({ ...manualDraft, network: event.target.value })}><option value="MTN_MOMO">MTN</option><option value="TELECEL_CASH">Telecel</option></select>}<input className="form-control" placeholder="Reference" value={manualDraft.reference} onChange={(event) => setManualDraft({ ...manualDraft, reference: event.target.value })} /><button className="button button-primary" type="submit">Record</button></form>)}</>}
        </section>}

        {tab === 'operations' && (isAdmin || isStaff || isSecurity) && <>
          {!isSecurity && <section className="admin-section">{sectionHeader('Maintenance', 'Maintenance requests', 'Assign and update room repair work.')}{maintenance.map((entry) => <div className="operation-row" key={entry.id}><strong>{entry.title}</strong><span>Room {entry.room.roomNumber}</span><span>{entry.student.user.fullName}</span>{(isAdmin || isStaff) ? <select className="form-control status-select" value={entry.status} onChange={(event) => runAction(() => updateMaintenance(entry.id, { status: event.target.value }), 'Maintenance status updated.')}><option value="OPEN">Open</option><option value="IN_PROGRESS">In progress</option><option value="RESOLVED">Resolved</option></select> : <span>{entry.status}</span>}</div>)}</section>}
          <section className="admin-section">{sectionHeader('Visitor register', 'Visitor check-in', 'Record arrivals and departures.')}{!isSecurity || user.role === 'SECURITY' ? <form className="hostel-form" onSubmit={submitVisitor}><Field label="Visitor name"><input className="form-control" required value={visitorDraft.fullName} onChange={(event) => setVisitorDraft({ ...visitorDraft, fullName: event.target.value })} /></Field><Field label="Host student ID"><input className="form-control" value={visitorDraft.studentId} onChange={(event) => setVisitorDraft({ ...visitorDraft, studentId: event.target.value })} /></Field><Field label="ID reference"><input className="form-control" value={visitorDraft.identityRef} onChange={(event) => setVisitorDraft({ ...visitorDraft, identityRef: event.target.value })} /></Field><Field label="Purpose"><input className="form-control" value={visitorDraft.purpose} onChange={(event) => setVisitorDraft({ ...visitorDraft, purpose: event.target.value })} /></Field><button className="button button-primary" type="submit">Check in</button></form> : null}{visitors.map((visitor) => <div className="operation-row" key={visitor.id}><strong>{visitor.fullName}</strong><span>{visitor.student?.user.fullName || 'No host'}</span><span>{visitor.status}</span><span>{new Date(visitor.checkedInAt).toLocaleString()}</span>{visitor.status !== 'CHECKED_OUT' && <button className="button button-secondary" type="button" onClick={() => runAction(() => checkOutVisitor(visitor.id), 'Visitor checked out.')}>Check out</button>}</div>)}</section>
          {isAdmin && <section className="admin-section">{sectionHeader('Notices', 'Publish a hostel notice', 'Notices are visible to all roles unless targeted.')}{<form className="form-stack compact-form" onSubmit={submitNotice}><Field label="Title"><input className="form-control" required value={noticeDraft.title} onChange={(event) => setNoticeDraft({ ...noticeDraft, title: event.target.value })} /></Field><Field label="Message"><textarea className="form-control" rows="4" required value={noticeDraft.body} onChange={(event) => setNoticeDraft({ ...noticeDraft, body: event.target.value })} /></Field><button className="button button-primary" type="submit">Publish notice</button></form>}</section>}
          {isAdmin && <section className="admin-section">{sectionHeader('Transfers', 'Room change requests', 'Approve a move only when a bed is available.')}{roomChangeRequests.map((request) => <div className="operation-row" key={request.id}><strong>{request.student.user.fullName} · {request.student.studentId}</strong><span>{request.booking.room.roomNumber} → {request.requestedRoom.roomNumber}</span><span>{request.reason}</span><button className="button button-primary" type="button" onClick={() => runAction(() => decideRoomChange(request.id, 'APPROVED'), 'Room transfer approved.')}>Approve</button><button className="button button-danger" type="button" onClick={() => runAction(() => decideRoomChange(request.id, 'REJECTED'), 'Room transfer declined.')}>Decline</button></div>)}</section>}
        </>}

        {tab === 'team' && isAdmin && <>
          <section className="admin-section">{sectionHeader('Staff accounts', 'Create staff access', 'Staff are assigned by an administrator and must change the temporary password.')}
            <form className="hostel-form" onSubmit={createStaffAccount}><Field label="Full name"><input className="form-control" required value={staffDraft.fullName} onChange={(event) => setStaffDraft({ ...staffDraft, fullName: event.target.value })} /></Field><Field label="Email"><input className="form-control" required type="email" value={staffDraft.email} onChange={(event) => setStaffDraft({ ...staffDraft, email: event.target.value })} /></Field><Field label="Temporary password (12+)"><input className="form-control" required minLength="12" type="password" value={staffDraft.temporaryPassword} onChange={(event) => setStaffDraft({ ...staffDraft, temporaryPassword: event.target.value })} /></Field><button className="button button-primary" type="submit">Create staff</button></form>
            <h3 className="portal-subheading">Optional security desk account</h3><form className="hostel-form" onSubmit={createSecurityAccount}><Field label="Full name"><input className="form-control" required value={securityDraft.fullName} onChange={(event) => setSecurityDraft({ ...securityDraft, fullName: event.target.value })} /></Field><Field label="Email"><input className="form-control" required type="email" value={securityDraft.email} onChange={(event) => setSecurityDraft({ ...securityDraft, email: event.target.value })} /></Field><Field label="Temporary password (12+)"><input className="form-control" required minLength="12" type="password" value={securityDraft.temporaryPassword} onChange={(event) => setSecurityDraft({ ...securityDraft, temporaryPassword: event.target.value })} /></Field><button className="button button-secondary" type="submit">Create security account</button></form>
            {staffAccounts.map((staff) => <div className="operation-row" key={staff.id}><strong>{staff.fullName}</strong><span>{staff.email}</span><span>{staff.mustChangePassword ? 'Change password required' : 'Active'}</span><button className="button button-danger" type="button" onClick={() => runAction(() => deactivateStaff(staff.id), 'Staff access removed.')}>Deactivate</button></div>)}
          </section>
          <section className="admin-section">{sectionHeader('Audit trail', 'Recent actions', 'Read-only record of authenticated changes.')}{auditLogs.map((entry) => <div className="operation-row" key={entry.id}><strong>{entry.action}</strong><span>{entry.actor?.fullName || 'System'}</span><span>{entry.entityType}</span><span>{new Date(entry.createdAt).toLocaleString()}</span></div>)}</section>
        </>}

        {tab === 'payments' && isAdmin && <section className="admin-section">{sectionHeader('Payments', 'Semester payment ledger', 'Provider-verified and manual payment records.', <button className="button button-secondary" type="button" onClick={exportPayments}>Export CSV</button>)}<div className="hostel-table-wrap"><table className="hostel-table"><thead><tr><th>Student</th><th>Room</th><th>Network / source</th><th>Reference</th><th>Amount</th><th>Status</th></tr></thead><tbody>{adminPayments.map((payment) => <tr key={payment.id}><td>{payment.student.user.fullName}<span className="user-email">{payment.student.studentId}</span></td><td>{payment.booking.room.roomNumber}</td><td>{payment.network || payment.source}</td><td>{payment.paystackReference || payment.momoReference || '—'}</td><td>{money(payment.amountPesewas)}</td><td>{payment.status}</td></tr>)}</tbody></table></div></section>}
      </main>
      {mustChangePassword && <div className="password-lock-backdrop"><section className="password-lock" role="dialog" aria-modal="true" aria-labelledby="password-lock-title"><span className="eyebrow">First sign-in</span><h2 id="password-lock-title">Change your temporary password</h2><p>For account safety, staff operations stay locked until you set a private password of at least 12 characters.</p><form className="form-stack" onSubmit={submitForcedPassword}><Field label="Temporary password"><input className="form-control" type="password" autoComplete="current-password" required value={passwordDraft.currentPassword} onChange={(event) => setPasswordDraft({ ...passwordDraft, currentPassword: event.target.value })} /></Field><Field label="New password"><input className="form-control" type="password" autoComplete="new-password" minLength="12" required value={passwordDraft.password} onChange={(event) => setPasswordDraft({ ...passwordDraft, password: event.target.value })} /></Field><Field label="Confirm new password"><input className="form-control" type="password" autoComplete="new-password" minLength="12" required value={passwordDraft.confirmPassword} onChange={(event) => setPasswordDraft({ ...passwordDraft, confirmPassword: event.target.value })} /></Field>{error && <p className="form-error" role="alert">{error}</p>}<button className="button button-primary" type="submit">Set new password</button><button className="button button-secondary" type="button" onClick={onLogout}>Sign out</button></form></section></div>}
    </div>
  );
}

export default PortalDashboard;