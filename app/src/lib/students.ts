import { StudentProfile } from './types';
import studentsJson from '../../../data/student_profiles/students.json';

export const studentsData: StudentProfile[] = studentsJson as StudentProfile[];
