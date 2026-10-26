const rooms = [
  {
    id: 'room-101',
    roomNumber: '101',
    block: 'Block A',
    type: 'Single',
    rent: 600,
    capacity: 1,
    occupied: 1,
    status: 'Occupied',
  },
  {
    id: 'room-102',
    roomNumber: '102',
    block: 'Block A',
    type: '2-in-1',
    rent: 420,
    capacity: 2,
    occupied: 1,
    status: 'Available',
  },
];

const residents = [
  {
    id: 'res-1',
    name: 'Ama Owusu',
    studentId: 'STD-1001',
    roomId: 'room-101',
    block: 'Block A',
    feeBalance: 240,
    status: 'Active',
  },
  {
    id: 'res-2',
    name: 'Kofi Mensah',
    studentId: 'STD-1002',
    roomId: 'room-102',
    block: 'Block A',
    feeBalance: 80,
    status: 'Active',
  },
];

function listRooms() {
  return rooms.map((room) => ({ ...room }));
}

function createRoom(input) {
  const room = {
    id: `room-${Date.now()}`,
    roomNumber: input.roomNumber,
    block: input.block,
    type: input.type,
    rent: Number(input.rent || 0),
    capacity: Number(input.capacity || 1),
    occupied: Number(input.occupied || 0),
    status: input.status || 'Available',
  };

  rooms.push(room);
  return { ...room };
}

function listResidents() {
  return residents.map((resident) => ({ ...resident }));
}

function createResident(input) {
  const resident = {
    id: `res-${Date.now()}`,
    name: input.name,
    studentId: input.studentId,
    roomId: input.roomId,
    block: input.block,
    feeBalance: Number(input.feeBalance || 0),
    status: input.status || 'Active',
  };

  residents.push(resident);
  return { ...resident };
}

function getDashboardSummary() {
  const totalRooms = rooms.length;
  const occupiedRooms = rooms.filter((room) => room.status === 'Occupied').length;
  const availableRooms = totalRooms - occupiedRooms;
  const totalResidents = residents.length;
  const outstandingFees = residents.reduce((sum, resident) => sum + Number(resident.feeBalance || 0), 0);

  return {
    totalRooms,
    occupiedRooms,
    availableRooms,
    totalResidents,
    outstandingFees,
    revenueTarget: rooms.reduce((sum, room) => sum + Number(room.rent || 0), 0),
  };
}

module.exports = {
  listRooms,
  createRoom,
  listResidents,
  createResident,
  getDashboardSummary,
};
